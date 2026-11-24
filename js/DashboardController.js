/* =====================================================================
   DashboardController.js
   Integração em tempo real com os dados gravados pelo VITA Android.
   Estrutura compartilhada:
     users/{uid}
     users/{uid}/refeicoes
     users/{uid}/agua

   O documento dashboard/summary continua sendo consultado somente para
   os gráficos antigos que ainda não possuem dados equivalentes no app
   Android (progresso de peso e atividade).
===================================================================== */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, requireAuth } from "./AuthService.js";

export const charts = {};
const listeners = [];

const COLORS = {
  calories: "#f97316",
  protein: "#22c55e",
  carbs: "#38bdf8",
  water: "#06b6d4",
  meals: ["#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#f97316"],
};

const emptyWeightProgress = {
  labels: [],
  values: [],
  comparison: { lastMonth: "--", thisMonth: "--" },
};

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    return Number(value.replace(",", ".")) || 0;
  }
  return 0;
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function sameDay(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear()
    && dateA.getMonth() === dateB.getMonth()
    && dateA.getDate() === dateB.getDate();
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatToday() {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function getMealFoods(meal) {
  return Array.isArray(meal.alimentos) ? meal.alimentos : [];
}

function getMealCalories(meal) {
  const stored = meal.total_calorias ?? meal.totalCalorias;
  if (stored !== undefined) return numberValue(stored);
  return getMealFoods(meal).reduce(
    (total, food) => total + numberValue(food.calorias),
    0,
  );
}

function getMealType(meal) {
  return String(meal.tipo ?? "Outros").trim() || "Outros";
}

function getWaterAmount(record) {
  return numberValue(record.quantidade_ml ?? record.quantidadeMl);
}

function getFoodsForDay(meals, day) {
  return meals
    .filter((meal) => {
      const date = dateValue(meal.data);
      return date && sameDay(date, day);
    })
    .flatMap(getMealFoods);
}

function calculateDailyData(profile, meals, waterRecords) {
  const today = new Date();
  const todayMeals = meals.filter((meal) => {
    const date = dateValue(meal.data);
    return date && sameDay(date, today);
  });

  const todayFoods = todayMeals.flatMap(getMealFoods);
  const calories = todayMeals.reduce(
    (total, meal) => total + getMealCalories(meal),
    0,
  );
  const proteins = todayFoods.reduce(
    (total, food) => total + numberValue(food.proteinas),
    0,
  );
  const carbs = todayFoods.reduce(
    (total, food) => total + numberValue(food.carboidratos),
    0,
  );
  const water = waterRecords.reduce((total, record) => {
    const date = dateValue(record.data);
    return date && sameDay(date, today)
      ? total + getWaterAmount(record)
      : total;
  }, 0);

  const idr = numberValue(profile.idr ?? profile.meta_calorica) || 0;
  const waterGoal = numberValue(profile.metaAgua)
    || Math.round(numberValue(profile.peso) * 35);

  return {
    calories,
    proteins,
    carbs,
    water,
    idr,
    waterGoal,
    mealCount: todayMeals.length,
  };
}

function createStatCard(icon, color, value, label, detail) {
  const card = document.createElement("div");
  card.className = "stat-card";

  const iconEl = document.createElement("div");
  iconEl.className = "stat-icon";
  iconEl.style.background = `${color}22`;
  iconEl.style.color = color;
  iconEl.textContent = icon;

  const valueEl = document.createElement("div");
  valueEl.className = "stat-value";
  valueEl.textContent = value;

  const labelEl = document.createElement("div");
  labelEl.className = "stat-label";
  labelEl.textContent = label;

  const detailEl = document.createElement("div");
  detailEl.className = "stat-delta";
  detailEl.textContent = detail;

  card.append(iconEl, valueEl, labelEl, detailEl);
  return card;
}

function renderStats(profile, meals, waterRecords) {
  const grid = document.getElementById("stat-grid");
  if (!grid) return;

  const data = calculateDailyData(profile, meals, waterRecords);
  grid.replaceChildren(
    createStatCard(
      "🔥",
      COLORS.calories,
      `${Math.round(data.calories)} kcal`,
      "Calorias consumidas",
      data.idr > 0 ? `Meta diária: ${Math.round(data.idr)} kcal` : "Meta não definida",
    ),
    createStatCard(
      "🥩",
      COLORS.protein,
      `${Math.round(data.proteins)} g`,
      "Proteínas",
      "Total registrado hoje",
    ),
    createStatCard(
      "🌾",
      COLORS.carbs,
      `${Math.round(data.carbs)} g`,
      "Carboidratos",
      "Total registrado hoje",
    ),
    createStatCard(
      "💧",
      COLORS.water,
      `${Math.round(data.water)} ml`,
      "Água consumida",
      data.waterGoal > 0 ? `Meta diária: ${Math.round(data.waterGoal)} ml` : "Meta não definida",
    ),
  );
}

function renderUser(profile, user) {
  const name = profile.nome || profile.name || user.displayName || user.email || "Usuário";
  const nameElement = document.getElementById("user-name");
  const dateElement = document.getElementById("today-date");
  const avatar = document.getElementById("user-avatar");

  if (nameElement) nameElement.textContent = name;
  if (dateElement) dateElement.textContent = formatToday();

  const avatarUrl = profile.avatarUrl || profile.foto || user.photoURL;
  if (avatar && avatarUrl) {
    avatar.style.backgroundImage = `url("${avatarUrl}")`;
    avatar.style.backgroundSize = "cover";
  }
}

function renderFavoriteFoods(meals) {
  const body = document.getElementById("fav-table-body");
  if (!body) return;

  const counts = new Map();

  meals.forEach((meal) => {
    getMealFoods(meal).forEach((food) => {
      const name = String(food.nome ?? food.name ?? "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase("pt-BR");
      const current = counts.get(key) || { name, count: 0 };
      current.count += 1;
      counts.set(key, current);
    });
  });

  const foods = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  body.replaceChildren();

  if (!foods.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "Ainda não há alimentos registrados.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  const maxCount = Math.max(...foods.map((food) => food.count), 1);

  foods.forEach((food, index) => {
    const row = document.createElement("tr");
    const rank = document.createElement("td");
    rank.textContent = String(index + 1);

    const name = document.createElement("td");
    name.textContent = food.name;

    const popularity = document.createElement("td");
    const track = document.createElement("div");
    track.className = "fav-bar-track";
    const fill = document.createElement("div");
    fill.className = "fav-bar-fill";
    fill.style.width = `${(food.count / maxCount) * 100}%`;
    fill.style.background = COLORS.meals[index % COLORS.meals.length];
    track.appendChild(fill);
    popularity.appendChild(track);

    const count = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "fav-count";
    badge.textContent = String(food.count);
    count.appendChild(badge);

    row.append(rank, name, popularity, count);
    body.appendChild(row);
  });
}

const gridStyle = { color: "rgba(255,255,255,0.05)" };

export function baseBarOptions(showLegendAxis = true) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#8a91b3" } },
      y: { display: showLegendAxis, grid: gridStyle, ticks: { color: "#8a91b3" } },
    },
  };
}

export function renderSimpleLegend(elementId, items) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.innerHTML = items
    .map((item) => `<span><span class="dot" style="background:${item.color}"></span>${escapeHtml(item.label)}</span>`)
    .join("");
}

function renderWeeklyCaloriesChart(meals) {
  const canvas = document.getElementById("chart-calorias");
  if (!canvas || typeof Chart === "undefined") return;
  if (charts.calorias) charts.calorias.destroy();

  const labels = [];
  const values = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    labels.push(new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day));

    const total = meals.reduce((sum, meal) => {
      const date = dateValue(meal.data);
      return date && sameDay(date, day) ? sum + getMealCalories(meal) : sum;
    }, 0);
    values.push(Math.round(total));
  }

  charts.calorias = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Consumidas",
        data: values,
        backgroundColor: COLORS.calories,
        borderRadius: 6,
        barThickness: 18,
      }],
    },
    options: baseBarOptions(),
  });

  renderSimpleLegend("legend-calorias", [
    { label: "Consumidas", color: COLORS.calories },
  ]);
}

function renderWeightProgressChart(data) {
  const canvas = document.getElementById("chart-peso");
  if (!canvas || typeof Chart === "undefined") return;
  if (charts.peso) charts.peso.destroy();

  const safe = data || emptyWeightProgress;
  charts.peso = new Chart(canvas, {
    type: "bar",
    data: {
      labels: safe.labels || [],
      datasets: [{
        label: "Peso (kg)",
        data: safe.values || [],
        backgroundColor: (context) => {
          const palette = ["#38bdf8", "#22c55e", "#f59e0b", "#ef4444"];
          return palette[context.dataIndex % palette.length];
        },
        borderRadius: 6,
        barThickness: 26,
      }],
    },
    options: baseBarOptions(false),
  });

  const comparison = safe.comparison || {};
  const legend = document.getElementById("legend-peso");
  if (legend) {
    legend.innerHTML = `
      <div class="legend-item"><span>Mês passado</span><strong>${escapeHtml(comparison.lastMonth ?? "--")}</strong></div>
      <div class="legend-item"><span>Este mês</span><strong>${escapeHtml(comparison.thisMonth ?? "--")}</strong></div>
    `;
  }
}

function renderHydrationActivityChart(waterRecords, legacyActivity = null) {
  const canvas = document.getElementById("chart-hidratacao");
  if (!canvas || typeof Chart === "undefined") return;
  if (charts.hidratacao) charts.hidratacao.destroy();

  const labels = [];
  const hydration = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    labels.push(new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day));

    const total = waterRecords.reduce((sum, record) => {
      const date = dateValue(record.data);
      return date && sameDay(date, day) ? sum + getWaterAmount(record) : sum;
    }, 0);
    hydration.push(Math.round(total));
  }

  const activity = Array.isArray(legacyActivity) && legacyActivity.length === 7
    ? legacyActivity
    : null;

  const datasets = [{
    label: "Hidratação (ml)",
    data: hydration,
    backgroundColor: COLORS.water,
    borderRadius: 6,
    barThickness: 18,
  }];

  if (activity) {
    datasets.push({
      label: "Atividade",
      data: activity,
      backgroundColor: "#f97316",
      borderRadius: 6,
      barThickness: 18,
    });
  }

  charts.hidratacao = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: baseBarOptions(),
  });

  const totalWater = hydration.reduce((sum, value) => sum + value, 0);
  const legendItems = [
    { label: `Água: ${totalWater} ml`, color: COLORS.water },
  ];
  if (activity) {
    const activityTotal = activity.reduce((sum, value) => sum + numberValue(value), 0);
    legendItems.push({ label: `Atividade: ${activityTotal}`, color: "#f97316" });
  }
  renderSimpleLegend("legend-hidratacao", legendItems);
}

function renderMealsPieChart(meals) {
  const canvas = document.getElementById("chart-refeicoes");
  if (!canvas || typeof Chart === "undefined") return;
  if (charts.refeicoes) charts.refeicoes.destroy();

  const counts = new Map();
  meals.forEach((meal) => {
    const type = getMealType(meal);
    counts.set(type, (counts.get(type) || 0) + 1);
  });

  const labels = [...counts.keys()];
  const values = [...counts.values()];
  const colors = labels.map((_, index) => COLORS.meals[index % COLORS.meals.length]);

  const total = values.reduce((sum, value) => sum + value, 0);
  const totalElement = document.getElementById("pie-total-num");
  if (totalElement) totalElement.textContent = String(total);

  charts.refeicoes = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        cutout: "68%",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  });

  const legend = document.getElementById("legend-refeicoes");
  if (legend) {
    legend.innerHTML = labels
      .map((label, index) => `<span><span class="dot" style="background:${colors[index]}"></span>${escapeHtml(label)}</span>`)
      .join("");
  }
}

function showDashboardError(message) {
  const content = document.querySelector(".content");
  if (!content) return;
  let error = content.querySelector(".data-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "data-error";
    content.prepend(error);
  }
  error.textContent = message;
}

function stopDashboardListeners() {
  while (listeners.length) {
    const unsubscribe = listeners.pop();
    unsubscribe();
  }
}

async function fetchLegacyDashboardData(uid) {
  try {
    const summaryRef = doc(db, "users", uid, "dashboard", "summary");
    const snapshot = await getDoc(summaryRef);
    return snapshot.exists() ? snapshot.data() : {};
  } catch (error) {
    console.warn("Resumo antigo do dashboard não disponível:", error);
    return {};
  }
}

function updateDashboard(profile, meals, waterRecords, user, legacyData) {
  renderUser(profile, user);
  renderStats(profile, meals, waterRecords);
  renderFavoriteFoods(meals);
  renderWeeklyCaloriesChart(meals);
  renderWeightProgressChart(legacyData.weightProgress || emptyWeightProgress);
  renderHydrationActivityChart(
    waterRecords,
    legacyData.hydrationActivity?.atividade || null,
  );
  renderMealsPieChart(meals);
}

export async function initDashboard() {
  const user = await requireAuth();
  if (!user) return;

  stopDashboardListeners();

  const profileRef = doc(db, "users", user.uid);
  const mealsQuery = query(
    collection(db, "users", user.uid, "refeicoes"),
    orderBy("data", "desc"),
  );
  const waterQuery = query(
    collection(db, "users", user.uid, "agua"),
    orderBy("data", "desc"),
  );

  let profile = {};
  let meals = [];
  let waterRecords = [];
  let legacyData = await fetchLegacyDashboardData(user.uid);

  const refresh = () => {
    updateDashboard(profile, meals, waterRecords, user, legacyData);
  };

  listeners.push(onSnapshot(profileRef, (snapshot) => {
    profile = snapshot.exists() ? snapshot.data() : {};
    refresh();
  }, (error) => {
    console.error("Erro ao observar perfil:", error);
    showDashboardError("Não foi possível sincronizar os dados do perfil.");
  }));

  listeners.push(onSnapshot(mealsQuery, (snapshot) => {
    meals = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    refresh();
  }, (error) => {
    console.error("Erro ao observar refeições:", error);
    showDashboardError("Não foi possível carregar as refeições do aplicativo.");
  }));

  listeners.push(onSnapshot(waterQuery, (snapshot) => {
    waterRecords = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    refresh();
  }, (error) => {
    console.error("Erro ao observar hidratação:", error);
    showDashboardError("Não foi possível carregar os registros de água do aplicativo.");
  }));

  document.getElementById("btn-export")?.addEventListener("click", () => {
    const rows = [
      ["Data", "Tipo", "Alimento", "Quantidade (g)", "Calorias", "Carboidratos", "Proteínas", "Gorduras"],
    ];

    meals.forEach((meal) => {
      const date = dateValue(meal.data);
      getMealFoods(meal).forEach((food) => {
        rows.push([
          date ? date.toLocaleDateString("pt-BR") : "",
          getMealType(meal),
          food.nome ?? "",
          food.gramas ?? food.quantidade ?? "",
          food.calorias ?? "",
          food.carboidratos ?? "",
          food.proteinas ?? "",
          food.gorduras ?? "",
        ]);
      });
    });

    const csv = rows.map((row) => row.map((value) => {
      const text = String(value ?? "").replace(/"/g, '""');
      return `"${text}"`;
    }).join(";")).join("\n");

    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vita-registros.csv";
    link.click();
    URL.revokeObjectURL(url);
  });
}

function stopProfileListener() {
  while (profileListeners.length) {
    profileListeners.pop()();
  }
}
const profileListeners = [];

function renderProfileIdentity(profile, user) {
  const name = profile.nome || profile.name || user.displayName || user.email || "Usuário";
  const nameElement = document.getElementById("profile-name");
  const handleElement = document.getElementById("profile-handle");
  const avatar = document.getElementById("profile-avatar");

  if (nameElement) nameElement.textContent = name;
  if (handleElement) handleElement.textContent = profile.Email || profile.email || user.email || "";

  const avatarUrl = profile.avatarUrl || profile.foto || user.photoURL;
  if (avatar && avatarUrl) {
    avatar.style.backgroundImage = `url("${avatarUrl}")`;
    avatar.style.backgroundSize = "cover";
  }
}

function renderProfileData(profile) {
  const peso = numberValue(profile.peso);
  const alturaRaw = numberValue(profile.altura);
  const altura = alturaRaw > 3 ? alturaRaw / 100 : alturaRaw;
  const imc = peso > 0 && altura > 0 ? peso / (altura * altura) : null;
  const metaAgua = numberValue(profile.metaAgua) || Math.round(peso * 35);

  const stats = [
    { icon: "⚖", label: "Peso atual", value: peso ? peso.toFixed(1) : "--", unit: "kg" },
    { icon: "🎯", label: "Meta de peso", value: numberValue(profile.pesoMeta) ? numberValue(profile.pesoMeta).toFixed(1) : "--", unit: "kg" },
    { icon: "💧", label: "Meta de água", value: metaAgua ? String(metaAgua) : "--", unit: "ml/dia" },
  ];

  const personalInfo = [
    { label: "Altura", value: altura ? `${altura.toFixed(2)} m` : "Não informada" },
    { label: "IMC", value: imc ? imc.toFixed(1) : "Não calculado", highlight: true },
    { label: "IDR", value: numberValue(profile.idr ?? profile.meta_calorica) ? `${Math.round(numberValue(profile.idr ?? profile.meta_calorica))} kcal` : "Não calculado" },
    { label: "Objetivo", value: profile.meta || "Não informado" },
    { label: "Nível de exercício", value: profile.nivelExercicio || "Não informado" },
    { label: "Sexo", value: profile.sexo || "Não informado" },
    { label: "Nascimento", value: profile.nascimento || "Não informado" },
  ];

  renderProfileStats(stats);
  renderPersonalInfo(personalInfo);
}

function renderProfileStats(stats) {
  const wrap = document.getElementById("profile-stats");
  if (!wrap) return;
  wrap.replaceChildren();

  stats.forEach((stat) => {
    const card = document.createElement("div");
    card.className = "profile-stat-card";

    const label = document.createElement("div");
    label.className = "stat-icon-label";
    label.textContent = `${stat.icon} ${stat.label}`;

    const value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = stat.value;

    const unit = document.createElement("div");
    unit.className = "stat-unit";
    unit.textContent = stat.unit;

    card.append(label, value, unit);
    wrap.appendChild(card);
  });
}

function renderPersonalInfo(items) {
  const grid = document.getElementById("info-grid");
  if (!grid) return;
  grid.replaceChildren();

  items.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "info-item";

    const label = document.createElement("div");
    label.className = "info-label";
    label.textContent = item.label;

    const value = document.createElement("div");
    value.className = `info-value ${item.highlight ? "highlight" : ""}`;
    value.textContent = item.value;

    wrapper.append(label, value);
    grid.appendChild(wrapper);
  });
}

function renderAchievements(data) {
  const subtitle = document.getElementById("achievements-sub");
  const grid = document.getElementById("achievements-grid");
  if (!subtitle || !grid) return;

  const achievements = data || { unlocked: 0, total: 0, items: [] };
  subtitle.textContent = `${achievements.unlocked || 0} de ${achievements.total || 0} desbloqueadas`;
  grid.replaceChildren();

  (achievements.items || []).forEach((achievement) => {
    const card = document.createElement("div");
    card.className = "achievement-card";
    const icon = document.createElement("div");
    icon.className = "achievement-icon";
    icon.textContent = achievement.icon || "★";
    const content = document.createElement("div");
    const title = document.createElement("div");
    title.className = "achievement-title";
    title.textContent = achievement.title || "";
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "achievement-subtitle";
    subtitleEl.textContent = achievement.subtitle || "";
    content.append(title, subtitleEl);
    card.append(icon, content);
    grid.appendChild(card);
  });
}

export async function fetchProfileData() {
  const user = await requireAuth();
  if (!user) throw new Error("Usuário não autenticado.");

  const [profileSnapshot, extrasSnapshot] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(db, "users", user.uid, "dashboard", "profile")),
  ]);

  return {
    user,
    profile: profileSnapshot.exists() ? profileSnapshot.data() : {},
    extras: extrasSnapshot.exists() ? extrasSnapshot.data() : {},
  };
}

export async function initProfilePage() {
  const user = await requireAuth();
  if (!user) return;

  stopProfileListener();

  profileListeners.push(onSnapshot(doc(db, "users", user.uid), (snapshot) => {
    const profile = snapshot.exists() ? snapshot.data() : {};
    renderProfileIdentity(profile, user);
    renderProfileData(profile);
  }, (error) => {
    console.error("Erro ao observar perfil:", error);
    const page = document.getElementById("profile-page");
    if (page) {
      const message = document.createElement("p");
      message.className = "data-error";
      message.textContent = "Não foi possível sincronizar os dados do perfil.";
      page.prepend(message);
    }
  }));

  try {
    const extras = await getDoc(doc(db, "users", user.uid, "dashboard", "profile"));
    renderAchievements(extras.exists() ? extras.data().achievements : null);
  } catch (error) {
    console.warn("Conquistas antigas não disponíveis:", error);
    renderAchievements(null);
  }

  document.getElementById("profile-back")?.addEventListener("click", () => {
    window.location.href = "iniciouser.html";
  });

  const updateButton = document.getElementById("btn-atualizar");
  if (updateButton) {
    updateButton.textContent = "Sincronizado";
    updateButton.disabled = true;
    updateButton.title = "As informações são atualizadas pelo aplicativo VITA.";
  }

  document.getElementById("btn-ver-todas")?.addEventListener("click", () => {
    alert("As conquistas ainda não estão integradas ao aplicativo.");
  });
}

window.addEventListener("beforeunload", () => {
  stopDashboardListeners();
  stopProfileListener();
});
