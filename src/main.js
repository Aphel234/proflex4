import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { createSampleData } from "./sample-data.js";
import { normalizeEvent, optimizeEvent, validateEvent } from "./optimizer.js";

const STORAGE_KEY = "workshop-zuteilung-github-pages-v2";
const LEGACY_STORAGE_KEY = "workshop-zuteilung-github-pages-v1";
let state = loadState();
let result = null;
let saveTimer = null;
let toastTimer = null;
let selectedCourseId = "";
let courseDetailTab = "assigned";
let editingGradeLimitsWorkshopIndex = -1;
let gradeLimitsDraft = {};
const resultUndoStack = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function createEmptyProject() {
  return normalizeEvent({
    name: "Neue Workshop-Veranstaltung",
    settings: {
      allowOutside: false,
      defaultMode: "Pflicht",
      balanceWeight: 10,
      balanceThreshold: 10,
      cohortMin: 0,
      qualityMode: "standard",
      gradePreferenceWeight: 50,
      rules: [],
    },
    workshops: [],
    participants: [],
    locks: [],
  });
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeEvent(JSON.parse(saved)) : createSampleData();
  } catch {
    return createSampleData();
  }
}

function scheduleSave() {
  $("#saveState").textContent = "speichert …";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("#saveState").textContent = "lokal gespeichert";
  }, 250);
}

function invalidateResult() {
  result = null;
  renderResults();
}

function commit({ invalidate = true } = {}) {
  state = normalizeEvent(state);
  scheduleSave();
  if (invalidate) invalidateResult();
  renderDashboard();
}

function deleteCurrentProject() {
  const projectName = String(state.name || "Aktuelles Projekt").trim();
  const confirmed = confirm(
    `Projekt „${projectName}“ wirklich löschen?\n\n` +
    "Alle lokal gespeicherten Workshops, Teilnehmer, Sperrungen, Regeln und Ergebnisse dieses Projekts werden entfernt. Dieser Schritt kann nicht rückgängig gemacht werden."
  );
  if (!confirmed) return;

  clearTimeout(saveTimer);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  state = createEmptyProject();
  result = null;
  selectedCourseId = "";
  courseDetailTab = "assigned";
  resultUndoStack.length = 0;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const detailDialog = $("#courseDetailDialog");
  if (detailDialog?.open) detailDialog.close();
  activateTab("dashboard");
  renderAll();
  $("#saveState").textContent = "lokal gespeichert";
  toast("Projekt gelöscht. Die Anwendung ist jetzt leer.");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value, selected, label = value) {
  return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function showDialog(title, messages, type = "error") {
  $("#dialogTitle").textContent = title;
  const list = Array.isArray(messages) ? messages : [messages];
  $("#dialogBody").innerHTML = list.map((message) => `<div class="message ${type}">${escapeHtml(message)}</div>`).join("");
  $("#messageDialog").showModal();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeFilename(value) {
  return String(value || "datei").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function courseTypes() {
  const map = new Map();
  for (const workshop of state.workshops) {
    if (workshop.offerId && !map.has(workshop.offerId)) map.set(workshop.offerId, workshop.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function workshopLabel(workshop) {
  if (!workshop) return "";
  return `${workshop.name}${workshop.session ? ` – Gruppe ${workshop.session}` : ""}`;
}

function gradeNumberFromClass(className) {
  const match = String(className || "").trim().match(/^(\d{1,2})/);
  return match ? Number(match[1]) : NaN;
}

function normalizeNullableLimit(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(500, Math.trunc(number))) : null;
}

function gradePreferenceWeightLabel(value) {
  const weight = Math.max(0, Math.min(100, Number(value) || 0));
  if (weight === 0) return "Nur Wünsche";
  if (weight < 40) return "Wünsche stärker";
  if (weight <= 60) return "Ausgewogen";
  if (weight < 100) return "Jahrgangsverteilung stärker";
  return "Jahrgangsverteilung maximal";
}

function updateGradePreferenceWeightOutput(value) {
  const output = $("#gradePreferenceWeightOutput");
  if (output) output.textContent = `${Number(value) || 0} % · ${gradePreferenceWeightLabel(value)}`;
}

function gradeLimitEntriesForWorkshop(workshop) {
  return Object.entries(workshop?.gradeLimits || {})
    .map(([grade, limit]) => ({ grade: Number(grade), min: normalizeNullableLimit(limit?.min), max: normalizeNullableLimit(limit?.max) }))
    .filter((item) => Number.isInteger(item.grade) && (item.min !== null || item.max !== null))
    .sort((a, b) => a.grade - b.grade);
}

function gradeLimitSummary(workshop) {
  const entries = gradeLimitEntriesForWorkshop(workshop);
  const parts = entries.map((item) => {
    if (item.min !== null && item.max !== null) return `Jg. ${item.grade}: ${item.min}–${item.max}`;
    if (item.min !== null) return `Jg. ${item.grade}: ≥ ${item.min}`;
    return `Jg. ${item.grade}: ≤ ${item.max}`;
  });
  if (workshop?.gradeGroupRule?.enabled) {
    parts.push(`Jahrgangsgruppen 8/9 + 10+ · Größe 4${workshop.gradeGroupRule.balance ? " · Ausgleich weich" : ""}`);
  }
  return parts.join(" · ") || "keine Vorgabe";
}

function gradeGroupSummaryForPeople(workshop, people) {
  if (!workshop?.gradeGroupRule?.enabled) return [];
  const counts = { sekI: 0, sekII: 0 };
  for (const person of people || []) {
    const grade = gradeNumberFromClass(person.className);
    if (grade >= 8 && grade <= 9) counts.sekI += 1;
    if (grade >= 10) counts.sekII += 1;
  }
  return [
    { key: "sekI", label: "Sek I (Jg. 8–9)", count: counts.sekI, remainder: counts.sekI % 4 },
    { key: "sekII", label: "Sek II (Jg. 10+)", count: counts.sekII, remainder: counts.sekII % 4 },
  ];
}

function parseYesNo(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["ja", "j", "yes", "true", "1", "an", "aktiv"].includes(normalized)) return true;
  if (["nein", "n", "no", "false", "0", "aus", "inaktiv"].includes(normalized)) return false;
  return fallback;
}

function openGradeLimitsDialog(index) {
  const workshop = state.workshops[index];
  if (!workshop) return;
  editingGradeLimitsWorkshopIndex = index;
  gradeLimitsDraft = JSON.parse(JSON.stringify(workshop.gradeLimits || {}));
  $("#gradeLimitsTitle").textContent = `Jahrgangs- und Gruppenregeln: ${workshopLabel(workshop)}`;
  $("#gradeLimitsSubtitle").textContent = `Diese Zusammensetzungsregeln werden bestmöglich erfüllt. Die gesamte Kursgröße bleibt verbindlich zwischen ${workshop.min} und ${workshop.max}.`;
  renderGradeLimitsDialog();
  $("#debateRuleEnabled").checked = workshop.gradeGroupRule?.enabled === true;
  $("#debateBalanceEnabled").checked = workshop.gradeGroupRule?.balance !== false;
  $("#debateBalanceEnabled").disabled = !$("#debateRuleEnabled").checked;
  $("#gradeLimitsDialog").showModal();
}

function renderGradeLimitsDialog() {
  const workshop = state.workshops[editingGradeLimitsWorkshopIndex];
  if (!workshop) return;
  const from = Math.max(1, Math.min(20, Number(workshop.gradeFrom) || 1));
  const to = Math.max(from, Math.min(20, Number(workshop.gradeTo) || from));
  const rows = [];
  for (let grade = from; grade <= to; grade += 1) {
    const limit = gradeLimitsDraft[String(grade)] || {};
    rows.push(`<tr><td><strong>Jahrgang ${grade}</strong></td><td><input type="number" min="0" max="500" step="1" data-grade="${grade}" data-grade-limit="min" value="${limit.min ?? ""}" placeholder="–"></td><td><input type="number" min="0" max="500" step="1" data-grade="${grade}" data-grade-limit="max" value="${limit.max ?? ""}" placeholder="–"></td></tr>`);
  }
  $("#gradeLimitsTable").innerHTML = `<thead><tr><th>Jahrgang</th><th>Minimum (Ziel)</th><th>Maximum (Ziel)</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function saveGradeLimitsDialog() {
  const workshop = state.workshops[editingGradeLimitsWorkshopIndex];
  if (!workshop) return;
  const next = {};
  const rows = [...$("#gradeLimitsTable").querySelectorAll("tbody tr")];
  for (const row of rows) {
    const minInput = row.querySelector('[data-grade-limit="min"]');
    const maxInput = row.querySelector('[data-grade-limit="max"]');
    const grade = Number(minInput?.dataset.grade || maxInput?.dataset.grade);
    const min = normalizeNullableLimit(minInput?.value);
    const max = normalizeNullableLimit(maxInput?.value);
    if (min !== null && max !== null && min > max) {
      return showDialog("Jahrgangsbelegung prüfen", `Jahrgang ${grade}: Minimum ${min} darf nicht größer als Maximum ${max} sein.`, "warning");
    }
    if (min !== null && min > workshop.max) {
      return showDialog("Jahrgangsbelegung prüfen", `Jahrgang ${grade}: Minimum ${min} ist größer als die gesamte Maximalbelegung ${workshop.max}.`, "warning");
    }
    if (min !== null || max !== null) next[String(grade)] = { min, max };
  }
  workshop.gradeLimits = next;
  workshop.gradeGroupRule = {
    enabled: $("#debateRuleEnabled").checked,
    balance: $("#debateBalanceEnabled").checked,
  };
  commit();
  renderWorkshops();
  $("#gradeLimitsDialog").close();
  toast("Jahrgangs- und Gruppenregeln gespeichert.");
}

function nextSessionLabel(offerId) {
  const used = new Set(state.workshops.filter((w) => w.offerId === offerId).map((w) => String(w.session || "").toUpperCase()));
  for (let code = 65; code <= 90; code += 1) {
    const label = String.fromCharCode(code);
    if (!used.has(label)) return label;
  }
  return String(used.size + 1);
}

function renderDashboard() {
  $("#eventName").value = state.name;
  $("#allowOutside").value = String(state.settings.allowOutside);
  $("#defaultMode").value = state.settings.defaultMode;
  const levels = [0, 10, 50, 100];
  const nearest = levels.reduce((best, value) => Math.abs(value - state.settings.balanceWeight) < Math.abs(best - state.settings.balanceWeight) ? value : best, 0);
  $("#balanceLevel").value = String(nearest);
  $("#balanceThreshold").value = state.settings.balanceThreshold ?? 10;
  $("#qualityMode").value = state.settings.qualityMode ?? "standard";
  $("#gradePreferenceWeight").value = state.settings.gradePreferenceWeight ?? 50;
  updateGradePreferenceWeightOutput(state.settings.gradePreferenceWeight ?? 50);

  const validation = validateEvent(state);
  const cards = [
    [state.participants.length, "Teilnehmer"],
    [courseTypes().length, "Kursarten"],
    [state.workshops.length, "Durchführungen"],
    [state.workshops.filter((w) => w.mode === "Pflicht").length, "Pflichtkurse"],
    [(state.settings.rules || []).filter((r) => r.enabled).length + state.workshops.filter((w) => w.gradeGroupRule?.enabled).length, "Aktive Regeln"],
    [state.participants.filter((p) => p.fixed).length, "Feste Setzungen"],
  ];
  $("#stats").innerHTML = cards.map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const messages = [];
  validation.errors.forEach((message) => messages.push(`<div class="message error">${escapeHtml(message)}</div>`));
  validation.warnings.slice(0, 12).forEach((message) => messages.push(`<div class="message warning">${escapeHtml(message)}</div>`));
  if (!messages.length) messages.push(`<div class="message">Eingaben sind grundsätzlich plausibel.</div>`);
  if (validation.warnings.length > 12) messages.push(`<div class="message warning">Weitere ${validation.warnings.length - 12} Warnungen werden beim Berechnen angezeigt.</div>`);
  $("#validationSummary").innerHTML = messages.join("");
  renderRules();
}

function ruleTypeName(type) {
  return ({
    class: "Pro Klasse",
    grade: "Pro Jahrgang",
    gradeForm: "Jahrgang + Bildungsgang",
    gradeAnyForm: "Jahrgang: mindestens ein Bildungsgang",
  })[type] || type;
}

function renderRules() {
  const rules = state.settings.rules || [];
  $("#rulesTable").innerHTML = `
    <thead><tr><th>Aktiv</th><th>Regel</th><th>Mindestens</th><th>Verbindlichkeit</th><th></th></tr></thead>
    <tbody>${rules.map((rule, index) => `<tr data-index="${index}">
      <td><input type="checkbox" data-rule-field="enabled" ${rule.enabled ? "checked" : ""}></td>
      <td><select data-rule-field="type">
        ${["class","grade","gradeForm","gradeAnyForm"].map((type) => option(type, rule.type, ruleTypeName(type))).join("")}
      </select></td>
      <td><input type="number" min="2" max="20" step="1" data-rule-field="min" value="${rule.min}"></td>
      <td><select data-rule-field="mode">${option("preferred", rule.mode, "Bevorzugt")}${option("hard", rule.mode, "Vorrangig")}</select></td>
      <td><button class="icon-button" data-action="delete-rule" title="Regel löschen">×</button></td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted">Keine zusätzliche Regel. Das ist völlig in Ordnung.</td></tr>`}</tbody>`;
}

function addRule() {
  state.settings.rules = state.settings.rules || [];
  state.settings.rules.push({ id: `R${Date.now()}`, type: "gradeForm", min: 2, mode: "preferred", enabled: true });
  commit();
  renderRules();
  $("#rulesDetails").open = true;
}

function handleRuleChange(event) {
  const control = event.target.closest("[data-rule-field]");
  if (!control) return;
  const row = control.closest("tr");
  const rule = state.settings.rules?.[Number(row?.dataset.index)];
  if (!rule) return;
  const field = control.dataset.ruleField;
  if (field === "enabled") rule.enabled = control.checked;
  else if (field === "min") rule.min = Math.max(2, Number(control.value) || 2);
  else rule[field] = control.value;
  commit();
}

function handleRuleClick(event) {
  const button = event.target.closest('[data-action="delete-rule"]');
  if (!button) return;
  const index = Number(button.closest("tr")?.dataset.index);
  state.settings.rules.splice(index, 1);
  commit();
  renderRules();
}

function renderWorkshops() {
  const rows = state.workshops.map((w, index) => `
    <tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><input data-entity="workshop" data-field="id" value="${escapeHtml(w.id)}" title="Eindeutige ID dieser Durchführung"></td>
      <td><input data-entity="workshop" data-field="offerId" value="${escapeHtml(w.offerId)}" title="Gleiche Kursart-ID = ein gemeinsamer Wunsch"></td>
      <td><input data-entity="workshop" data-field="name" value="${escapeHtml(w.name)}"></td>
      <td><input data-entity="workshop" data-field="session" value="${escapeHtml(w.session)}" placeholder="A"></td>
      <td><input type="number" min="1" max="20" data-entity="workshop" data-field="gradeFrom" value="${w.gradeFrom}"></td>
      <td><input type="number" min="1" max="20" data-entity="workshop" data-field="gradeTo" value="${w.gradeTo}"></td>
      <td><select data-entity="workshop" data-field="schoolForm">${["Alle", "Regional", "Gymnasial"].map((v) => option(v, w.schoolForm)).join("")}</select></td>
      <td><input type="number" min="0" max="20" data-entity="workshop" data-field="cohortMin" value="${w.cohortMin ?? ""}" placeholder="global" title="leer = global, 0 = aus"></td>
      <td><input type="number" min="0" max="500" data-entity="workshop" data-field="min" value="${w.min}"></td>
      <td><input type="number" min="1" max="500" data-entity="workshop" data-field="max" value="${w.max}"></td>
      <td class="grade-limit-cell"><button class="button compact-button grade-limit-button" type="button" data-action="edit-grade-limits" title="Jahrgangsgrenzen und Jahrgangsgruppen-Regel festlegen">Jahrgänge & Gruppen …</button><small>${escapeHtml(gradeLimitSummary(w))}</small></td>
      <td><select data-entity="workshop" data-field="mode">${["Pflicht", "Optional"].map((v) => option(v, w.mode)).join("")}</select></td>
      <td class="row-actions"><button class="icon-button" data-action="duplicate-workshop" title="Weitere Durchführung derselben Kursart">＋</button><button class="icon-button" data-action="delete-workshop" title="Löschen">×</button></td>
    </tr>`).join("");
  $("#workshopsTable").innerHTML = `
    <thead><tr><th>#</th><th>Durchführungs-ID</th><th>Kursart-ID</th><th>Kursart</th><th>Gruppe</th><th>Klasse von</th><th>Klasse bis</th><th>Bildungsgang</th><th>Kohorte min. (bestmöglich)</th><th>Minimum</th><th>Maximum</th><th>Jahrgangs- & Gruppenregeln</th><th>Pflicht/Optional</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="14">Keine Workshops eingetragen.</td></tr>`}</tbody>`;
}

function renderParticipants() {
  const query = $("#participantSearch").value.trim().toLowerCase();
  const wishOptions = [`<option value="">–</option>`, ...courseTypes().map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.id)} · ${escapeHtml(course.name)}</option>`)].join("");
  const fixedOptions = [`<option value="">–</option>`, ...state.workshops.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${escapeHtml(workshopLabel(w))}</option>`)].join("");
  const visible = state.participants.map((p, index) => ({ p, index })).filter(({ p }) => {
    if (!query) return true;
    return [p.id, p.firstName, p.lastName, p.className, p.schoolForm].join(" ").toLowerCase().includes(query);
  });

  const rows = visible.map(({ p, index }) => {
    const wishSelect = (slot) => `<select data-entity="participant" data-field="wish${slot}">${wishOptions.replace(`value="${escapeHtml(p.wishes[slot])}"`, `value="${escapeHtml(p.wishes[slot])}" selected`)}</select>`;
    const fixedSelect = `<select data-entity="participant" data-field="fixed">${fixedOptions.replace(`value="${escapeHtml(p.fixed)}"`, `value="${escapeHtml(p.fixed)}" selected`)}</select>`;
    return `<tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><input data-entity="participant" data-field="id" value="${escapeHtml(p.id)}"></td>
      <td><input data-entity="participant" data-field="firstName" value="${escapeHtml(p.firstName)}"></td>
      <td><input data-entity="participant" data-field="lastName" value="${escapeHtml(p.lastName)}"></td>
      <td><input data-entity="participant" data-field="className" value="${escapeHtml(p.className)}"></td>
      <td><select data-entity="participant" data-field="schoolForm">${["Regional", "Gymnasial"].map((v) => option(v, p.schoolForm)).join("")}</select></td>
      <td>${wishSelect(0)}</td><td>${wishSelect(1)}</td><td>${wishSelect(2)}</td><td>${wishSelect(3)}</td>
      <td>${fixedSelect}</td>
      <td><button class="icon-button" data-action="delete-participant" title="Löschen">×</button></td>
    </tr>`;
  }).join("");

  $("#participantsTable").innerHTML = `
    <thead><tr><th>#</th><th>Person-ID</th><th>Vorname</th><th>Nachname</th><th>Klasse</th><th>Bildungsgang</th><th>1. Wunsch</th><th>2. Wunsch</th><th>3. Wunsch</th><th>4. Wunsch</th><th>Feste Setzung (Durchführung)</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="12">Keine passenden Teilnehmer.</td></tr>`}</tbody>`;
}

function renderLocks() {
  const personOptions = [`<option value="">–</option>`, ...state.participants.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} · ${escapeHtml(p.lastName)}, ${escapeHtml(p.firstName)}</option>`)].join("");
  const workshopOptions = [`<option value="">–</option>`, ...state.workshops.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${escapeHtml(workshopLabel(w))}</option>`)].join("");
  const rows = state.locks.map((lock, index) => `
    <tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><select data-entity="lock" data-field="personId">${personOptions.replace(`value="${escapeHtml(lock.personId)}"`, `value="${escapeHtml(lock.personId)}" selected`)}</select></td>
      <td><select data-entity="lock" data-field="workshopId">${workshopOptions.replace(`value="${escapeHtml(lock.workshopId)}"`, `value="${escapeHtml(lock.workshopId)}" selected`)}</select></td>
      <td><input data-entity="lock" data-field="reason" value="${escapeHtml(lock.reason)}"></td>
      <td><button class="icon-button" data-action="delete-lock" title="Löschen">×</button></td>
    </tr>`).join("");
  $("#locksTable").innerHTML = `
    <thead><tr><th>#</th><th>Person</th><th>Workshop</th><th>Grund</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">Keine Sperrungen eingetragen.</td></tr>`}</tbody>`;
}

function statCards(stats) {
  const totalChoices = Math.max(1, (stats.first || 0) + (stats.second || 0) + (stats.third || 0) + (stats.fourth || 0) + (stats.outside || 0));
  const pct = (value) => `${Math.round(100 * (value || 0) / totalChoices)} %`;
  const items = [
    [`${stats.first} (${pct(stats.first)})`, "Erstwünsche"],
    [`${stats.second} (${pct(stats.second)})`, "Zweitwünsche"],
    [`${stats.third} (${pct(stats.third)})`, "Drittwünsche"],
    [`${stats.fourth} (${pct(stats.fourth)})`, "Viertwünsche"],
    [stats.maxThirdPerCourse ?? 0, "Max. Drittwünsche / Kurs"],
    [stats.maxFourthPerCourse ?? 0, "Max. Viertwünsche / Kurs"],
    [stats.unassigned, "Ohne Workshop-Zuteilung"],
    [stats.largeCourseSpread ?? "–", "Spannweite große Kurse"],
    [stats.ruleViolationCount ?? 0, "Regelabweichungen"],
    [`${stats.gradePreferenceWeight ?? 50} %`, "Gewicht Jahrgangsverteilung"],
    [stats.gradeGroupImbalance ?? 0, "Differenz Jahrgangsgruppen"],
    [stats.meanDeviation.toFixed(2), "Ø Zielabweichung"],
    [result?.quality ? `${result.quality.successfulRuns}/${result.quality.runsTried}` : "–", "Qualitätsläufe"],
  ];
  return items.map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function wishQualityForCourse(courseId) {
  const rows = result?.participantResults?.filter((row) => row.workshopId === courseId) || [];
  const counts = { Erstwunsch: 0, Zweitwunsch: 0, Drittwunsch: 0, Viertwunsch: 0, "Feste Setzung": 0, "Kein Wunsch": 0 };
  rows.forEach((row) => { if (counts[row.type] !== undefined) counts[row.type] += 1; });
  const parts = [];
  if (counts.Erstwunsch) parts.push(`${counts.Erstwunsch}× 1.`);
  if (counts.Zweitwunsch) parts.push(`${counts.Zweitwunsch}× 2.`);
  if (counts.Drittwunsch) parts.push(`${counts.Drittwunsch}× 3.`);
  if (counts.Viertwunsch) parts.push(`${counts.Viertwunsch}× 4.`);
  if (counts["Feste Setzung"]) parts.push(`${counts["Feste Setzung"]} fest`);
  if (counts["Kein Wunsch"]) parts.push(`${counts["Kein Wunsch"]} außerhalb`);
  return parts.join(" · ") || "–";
}

function resultRuleBadge(course) {
  if (course.ruleDeviations) return `<span class="badge warn">${course.ruleDeviations} Abweichung(en)</span>`;
  return `<span class="badge good">erfüllt</span>`;
}

function renderResults() {
  const placeholder = $("#resultPlaceholder");
  const content = $("#resultContent");
  if (!result?.ok) {
    placeholder.hidden = false;
    content.hidden = true;
    return;
  }
  placeholder.hidden = true;
  content.hidden = false;
  $("#resultStats").innerHTML = statCards(result.stats);
  $("#courseResultsTable").innerHTML = `
    <thead><tr><th>Kurs</th><th>Belegung</th><th>Ziel</th><th>Min / Max</th><th>Wunschqualität</th><th>Regeln</th><th>Status</th><th></th></tr></thead>
    <tbody>${result.courseResults.map((course) => `<tr class="course-result-row" data-course-id="${escapeHtml(course.id)}">
      <td><strong>${escapeHtml(workshopLabel(course))}</strong></td>
      <td>${course.load}</td><td>${course.target}</td><td>${course.effectiveMin} / ${course.max}</td>
      <td>${escapeHtml(wishQualityForCourse(course.id))}</td>
      <td>${resultRuleBadge(course)}</td>
      <td><span class="badge ${course.open ? "good" : "warn"}">${escapeHtml(course.status)}</span></td>
      <td><button class="button compact-button" type="button" data-action="open-course-detail" data-course-id="${escapeHtml(course.id)}">Details</button></td>
    </tr>`).join("")}</tbody>`;
  $("#participantResultsTable").innerHTML = `
    <thead><tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Workshop</th><th>Zuteilungsart</th><th>Hinweis</th></tr></thead>
    <tbody>${[...result.participantResults].sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de")).map((row) => `<tr>
      <td>${escapeHtml(row.lastName)}</td><td>${escapeHtml(row.firstName)}</td><td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.workshopName || "–")}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.note)}</td>
    </tr>`).join("")}</tbody>`;
}

function courseById(id) {
  return result?.courseResults?.find((course) => course.id === id) || null;
}

function participantStateById(id) {
  return state.participants.find((person) => person.id === id) || null;
}

function participantResultById(id) {
  return result?.participantResults?.find((person) => person.personId === id) || null;
}

function hardGroupingKey(rule, person) {
  const grade = String(person.className || "").match(/^(\d{1,2})/)?.[1] || "";
  if (rule.type === "class") return String(person.className || "");
  if (rule.type === "grade") return grade;
  if (rule.type === "gradeForm") return `${grade}\u0000${person.schoolForm}`;
  return grade;
}

function hardViolationsForCourseFromResult(courseId) {
  const course = state.workshops.find((item) => item.id === courseId);
  if (!course) return [];
  const assigned = result.participantResults.filter((row) => row.workshopId === courseId).map((row) => participantStateById(row.personId)).filter(Boolean);
  const violations = [];
  const rules = (state.settings.rules || []).filter((rule) => rule.enabled && rule.mode === "hard");
  for (const rule of rules) {
    if (rule.type !== "gradeAnyForm") {
      const groups = new Map();
      assigned.forEach((person) => {
        const key = hardGroupingKey(rule, person);
        if (!key) return;
        groups.set(key, (groups.get(key) || 0) + 1);
      });
      for (const [key, count] of groups) if (count > 0 && count < rule.min) violations.push(`${ruleTypeName(rule.type)} ${key}: ${count} < ${rule.min}`);
    } else {
      const byGrade = new Map();
      assigned.forEach((person) => {
        const grade = hardGroupingKey(rule, person);
        if (!byGrade.has(grade)) byGrade.set(grade, new Map());
        const forms = byGrade.get(grade);
        forms.set(person.schoolForm, (forms.get(person.schoolForm) || 0) + 1);
      });
      for (const [grade, forms] of byGrade) {
        const max = Math.max(0, ...forms.values());
        if (max > 0 && max < rule.min) violations.push(`Jahrgang ${grade}: kein Bildungsgang erreicht ${rule.min}`);
      }
    }
  }
  const gradeCounts = new Map();
  assigned.forEach((person) => {
    const grade = gradeNumberFromClass(person.className);
    if (Number.isFinite(grade)) gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + 1);
  });
  for (const limit of gradeLimitEntriesForWorkshop(course)) {
    const count = gradeCounts.get(limit.grade) || 0;
    if (limit.min !== null && count < limit.min) violations.push(`Jahrgang ${limit.grade}: ${count} < Minimum ${limit.min}`);
    if (limit.max !== null && count > limit.max) violations.push(`Jahrgang ${limit.grade}: ${count} > Maximum ${limit.max}`);
  }
  for (const group of gradeGroupSummaryForPeople(course, assigned)) {
    if (group.remainder !== 0) violations.push(`${group.label}: ${group.count} ist nicht durch 4 teilbar`);
  }

  const legacyMin = course.cohortMin === null ? (state.settings.cohortMin || 0) : course.cohortMin;
  if (legacyMin >= 2) {
    const groups = new Map();
    assigned.forEach((person) => {
      const grade = String(person.className || "").match(/^(\d{1,2})/)?.[1] || "";
      const key = `${grade} / ${person.schoolForm}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    for (const [key, count] of groups) if (count > 0 && count < legacyMin) violations.push(`${key}: ${count} < ${legacyMin}`);
  }
  return violations;
}

function manualEligibility(person, course) {
  const grade = Number(String(person.className || "").match(/^(\d{1,2})/)?.[1]);
  if (!Number.isFinite(grade) || grade < course.gradeFrom || grade > course.gradeTo) return "Klassenstufe passt nicht.";
  if (course.schoolForm !== "Alle" && course.schoolForm !== person.schoolForm) return "Bildungsgang passt nicht.";
  if (state.locks.some((lock) => lock.personId === person.id && lock.workshopId === course.id)) return "Diese Kombination ist gesperrt.";
  return "";
}

function snapshotResult() {
  resultUndoStack.push(JSON.parse(JSON.stringify(result)));
  if (resultUndoStack.length > 20) resultUndoStack.shift();
}

function refreshResultAfterManualChange() {
  const courseMap = new Map(state.workshops.map((course) => [course.id, course]));
  const personMap = new Map(state.participants.map((person) => [person.id, person]));
  const loads = new Map(state.workshops.map((course) => [course.id, 0]));
  for (const row of result.participantResults) {
    const person = personMap.get(row.personId);
    const course = courseMap.get(row.workshopId);
    if (row.workshopId) loads.set(row.workshopId, (loads.get(row.workshopId) || 0) + 1);
    row.workshopName = course ? workshopLabel(course) : "";
    row.offerId = course?.offerId || "";
    row.courseTypeName = course?.name || "";
    row.session = course?.session || "";
    if (person && course) {
      const idx = person.wishes.findIndex((wish) => wish === course.offerId);
      row.type = person.fixed === course.id ? "Feste Setzung" : (["Erstwunsch","Zweitwunsch","Drittwunsch","Viertwunsch"][idx] || "Kein Wunsch");
    } else row.type = "Nicht zugeteilt";
  }
  for (const course of result.courseResults) {
    course.load = loads.get(course.id) || 0;
    course.deviation = course.open ? course.load - course.target : 0;
    const assignedPeople = result.participantResults
      .filter((row) => row.workshopId === course.id)
      .map((row) => personMap.get(row.personId))
      .filter(Boolean);
    course.gradeGroupSummary = gradeGroupSummaryForPeople(course, assignedPeople);
    course.gradeGroupImbalance = course.gradeGroupRule?.enabled && course.gradeGroupRule?.balance !== false
      ? Math.abs((course.gradeGroupSummary[0]?.count || 0) - (course.gradeGroupSummary[1]?.count || 0))
      : 0;
    const hard = hardViolationsForCourseFromResult(course.id);
    course.ruleHardViolations = hard.length;
    course.ruleHints = hard;
    course.ruleDeviations = hard.length + (course.rulePreferredViolations || 0);
    course.ruleStatus = course.ruleDeviations ? "Bestmögliche Abweichung" : "Regeln erfüllt";
  }
  const counts = new Map();
  result.participantResults.forEach((row) => counts.set(row.type, (counts.get(row.type) || 0) + 1));
  result.stats.first = counts.get("Erstwunsch") || 0;
  result.stats.second = counts.get("Zweitwunsch") || 0;
  result.stats.third = counts.get("Drittwunsch") || 0;
  result.stats.fourth = counts.get("Viertwunsch") || 0;
  result.stats.fixed = counts.get("Feste Setzung") || 0;
  result.stats.outside = counts.get("Kein Wunsch") || 0;
  result.stats.unassigned = counts.get("Nicht zugeteilt") || 0;
  const open = result.courseResults.filter((course) => course.open);
  result.stats.meanDeviation = open.length ? open.reduce((sum, course) => sum + Math.abs(course.deviation), 0) / open.length : 0;
  result.stats.hardRuleViolations = result.courseResults.reduce((sum, course) => sum + (course.ruleHardViolations || 0), 0);
  result.stats.ruleViolationCount = result.courseResults.reduce((sum, course) => sum + (course.ruleDeviations || 0), 0);
  result.stats.gradeGroupImbalance = open.reduce((sum, course) => sum + (course.gradeGroupImbalance || 0), 0);
  renderResults();
}

function moveParticipant(personId, toCourseId) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  const target = courseById(toCourseId);
  const source = row ? courseById(row.workshopId) : null;
  if (!row || !person || !target) return;
  if (person.fixed && person.fixed !== toCourseId) return showDialog("Verschieben nicht möglich", "Die Person hat eine feste Setzung. Diese zuerst lösen.", "warning");
  const eligibility = manualEligibility(person, target);
  if (eligibility) return showDialog("Verschieben nicht möglich", eligibility, "warning");
  if (target.load >= target.max) return showDialog("Verschieben nicht möglich", "Der Zielkurs ist bereits voll.", "warning");
  if (source && source.load - 1 < source.effectiveMin) return showDialog("Verschieben nicht möglich", "Der bisherige Kurs würde unter seine Mindestbelegung fallen.", "warning");

  snapshotResult();
  const oldId = row.workshopId;
  row.workshopId = toCourseId;
  refreshResultAfterManualChange();
  const hardIssues = [...new Set([...(oldId ? hardViolationsForCourseFromResult(oldId) : []), ...hardViolationsForCourseFromResult(toCourseId)])];
  if (hardIssues.length) {
    result = resultUndoStack.pop();
    renderResults();
    return showDialog("Verschieben verletzt eine vorrangige Regel", hardIssues, "warning");
  }
  renderCourseDetail();
  toast("Person verschoben. Mit ↶ kann die Änderung rückgängig gemacht werden.");
}

function fixParticipant(personId) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  if (!row || !person || !row.workshopId) return;
  person.fixed = row.workshopId;
  commit({ invalidate: false });
  refreshResultAfterManualChange();
  renderCourseDetail();
  toast("Aktuelle Zuordnung wurde festgesetzt.");
}

function swapSuggestions(courseId) {
  const assigned = result.participantResults.filter((row) => row.workshopId === courseId);
  const outside = result.participantResults.filter((row) => row.workshopId && row.workshopId !== courseId);
  const suggestions = [];
  const currentCourse = courseById(courseId);
  for (const a of assigned) {
    const pa = participantStateById(a.personId);
    if (!pa || pa.fixed) continue;
    for (const b of outside) {
      const pb = participantStateById(b.personId);
      const otherCourse = courseById(b.workshopId);
      if (!pb || pb.fixed || !otherCourse) continue;
      if (manualEligibility(pa, otherCourse) || manualEligibility(pb, currentCourse)) continue;
      const aNow = pa.wishes.indexOf(currentCourse.offerId); const aNew = pa.wishes.indexOf(otherCourse.offerId);
      const bNow = pb.wishes.indexOf(otherCourse.offerId); const bNew = pb.wishes.indexOf(currentCourse.offerId);
      const norm = (idx) => idx < 0 ? 5 : idx;
      const gain = (norm(aNow) - norm(aNew)) + (norm(bNow) - norm(bNew));
      if (gain > 0) suggestions.push({ a, b, gain, otherCourse });
    }
  }
  return suggestions.sort((x, y) => y.gain - x.gain).slice(0, 8);
}

function applySwap(aId, bId) {
  const a = participantResultById(aId); const b = participantResultById(bId);
  if (!a || !b) return;
  snapshotResult();
  const aCourse = a.workshopId; const bCourse = b.workshopId;
  a.workshopId = bCourse; b.workshopId = aCourse;
  refreshResultAfterManualChange();
  const issues = [...hardViolationsForCourseFromResult(aCourse), ...hardViolationsForCourseFromResult(bCourse)];
  if (issues.length) {
    result = resultUndoStack.pop(); renderResults();
    return showDialog("Tausch verletzt eine vorrangige Regel", issues, "warning");
  }
  renderCourseDetail(); toast("Tausch durchgeführt.");
}

function renderCourseDetail() {
  if (!result?.ok) return;
  const courses = result.courseResults.filter((course) => course.open);
  if (!courses.length) return;
  if (!selectedCourseId || !courses.some((course) => course.id === selectedCourseId)) selectedCourseId = courses[0].id;
  const course = courseById(selectedCourseId);
  if (!course) return;
  $("#courseDetailTitle").textContent = workshopLabel(course);
  $("#courseDetailSelect").innerHTML = courses.map((item) => option(item.id, selectedCourseId, workshopLabel(item))).join("");
  const quality = wishQualityForCourse(course.id);
  $("#courseDetailStats").innerHTML = [
    [course.load, "Belegung"], [course.target, "Ziel"], [`${course.effectiveMin} / ${course.max}`, "Min / Max"], [quality, "Wünsche"]
  ].map(([value, label]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join("");
  const details = course.ruleDetails || [];
  const gradeLimits = course.gradeLimitSummary || [];
  const gradeLimitLabel = "Jahrgangsvorgaben (bestmöglich):";
  const gradeLimitHtml = gradeLimits.length ? `<div class="grade-limit-result"><strong>${gradeLimitLabel}</strong> ${gradeLimits.map((item) => {
    const bounds = item.min !== null && item.max !== null ? `${item.min}–${item.max}` : item.min !== null ? `mind. ${item.min}` : `max. ${item.max}`;
    return `Jg. ${item.grade}: ${item.count} (${bounds})`;
  }).join(" · ")}</div>` : "";
  const gradeGroups = course.gradeGroupSummary || [];
  const gradeGroupHtml = gradeGroups.length ? `<div class="grade-limit-result debate-result"><strong>Jahrgangsgruppen-Regel · Gruppengröße 4 (bestmöglich):</strong> ${gradeGroups.map((item) => `${escapeHtml(item.label)}: ${item.count}${item.remainder === 0 ? " ✓" : " – nicht durch 4 teilbar"}`).join(" · ")}${course.gradeGroupRule?.balance ? `<br><span class="muted">Weicher Ausgleich: Differenz ${course.gradeGroupImbalance || 0}</span>` : ""}</div>` : "";
  const ruleHints = course.ruleHints || [];
  const detailsHtml = details.length || ruleHints.length
    ? `<details><summary>${resultRuleBadge(course)} Regeldetails anzeigen</summary>${ruleHints.map((hint) => `<div class="message warning">${escapeHtml(hint)}</div>`).join("")}${details.map((item) => `<div class="message warning">${escapeHtml(ruleTypeName(item.type))}: ${escapeHtml(item.label)} · ${item.count} von mindestens ${item.min}</div>`).join("")}</details>`
    : resultRuleBadge(course);
  $("#courseRuleSummary").innerHTML = `${gradeGroupHtml}${gradeLimitHtml}${detailsHtml}`;

  $$(".detail-tab").forEach((button) => button.classList.toggle("active", button.dataset.detailTab === courseDetailTab));
  const assigned = result.participantResults.filter((row) => row.workshopId === course.id).sort((a,b) => a.lastName.localeCompare(b.lastName,"de") || a.firstName.localeCompare(b.firstName,"de"));
  if (courseDetailTab === "assigned") {
    $("#courseDetailBody").innerHTML = `<div class="table-wrap"><table class="detail-table"><thead><tr><th>Name</th><th>Klasse</th><th>Bildungsgang</th><th>Wunsch</th><th>Nachbearbeitung</th></tr></thead><tbody>${assigned.map((row) => {
      const person = participantStateById(row.personId);
      const destinationOptions = result.courseResults
        .filter((item) => item.open && item.id !== course.id && item.load < item.max)
        .filter((item) => person && !manualEligibility(person, item))
        .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(workshopLabel(item))}</option>`).join("");
      return `<tr>
      <td><strong>${escapeHtml(row.lastName)}, ${escapeHtml(row.firstName)}</strong></td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.schoolForm)}</td><td>${escapeHtml(row.type)}</td>
      <td><div class="move-controls"><select data-move-person="${escapeHtml(row.personId)}"><option value="">Zielkurs …</option>${destinationOptions}</select><button type="button" class="button" data-action="move-person" data-person-id="${escapeHtml(row.personId)}">Verschieben</button><button type="button" class="button" data-action="fix-person" data-person-id="${escapeHtml(row.personId)}">Festsetzen</button></div></td>
    </tr>`; }).join("")}</tbody></table></div>`;
  } else if (courseDetailTab === "applicants") {
    const applicants = result.participantResults.filter((row) => participantStateById(row.personId)?.wishes.includes(course.offerId)).sort((a,b) => {
      const pa = participantStateById(a.personId); const pb = participantStateById(b.personId);
      return pa.wishes.indexOf(course.offerId) - pb.wishes.indexOf(course.offerId) || a.lastName.localeCompare(b.lastName,"de");
    });
    $("#courseDetailBody").innerHTML = `<div class="table-wrap"><table class="detail-table"><thead><tr><th>Name</th><th>Klasse</th><th>Bildungsgang</th><th>Einwahl</th><th>Tatsächlich zugeteilt</th></tr></thead><tbody>${applicants.map((row) => { const person=participantStateById(row.personId); const rank=person.wishes.indexOf(course.offerId); return `<tr><td>${escapeHtml(row.lastName)}, ${escapeHtml(row.firstName)}</td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.schoolForm)}</td><td>${rank+1}. Wunsch</td><td>${escapeHtml(row.workshopName || "Nicht zugeteilt")}</td></tr>`; }).join("")}</tbody></table></div>`;
  } else {
    const swaps = swapSuggestions(course.id);
    $("#courseDetailBody").innerHTML = swaps.length ? `<div class="swap-list">${swaps.map((item) => `<div class="swap-card"><div><strong>${escapeHtml(item.a.lastName)}, ${escapeHtml(item.a.firstName)}</strong> ↔ <strong>${escapeHtml(item.b.lastName)}, ${escapeHtml(item.b.firstName)}</strong><br><span class="muted">${escapeHtml(workshopLabel(course))} ↔ ${escapeHtml(workshopLabel(item.otherCourse))} · Verbesserung: ${item.gain} Wunschstufe(n)</span></div><button type="button" class="button" data-action="apply-swap" data-a="${escapeHtml(item.a.personId)}" data-b="${escapeHtml(item.b.personId)}">Tauschen</button></div>`).join("")}</div>` : `<div class="empty-state">Keine einfache Tauschverbesserung gefunden.</div>`;
  }
  $("#undoMoveBtn").disabled = !resultUndoStack.length;
}

function openCourseDetail(courseId) {
  selectedCourseId = courseId;
  courseDetailTab = "assigned";
  renderCourseDetail();
  $("#courseDetailDialog").showModal();
}

function renderAll() {
  renderDashboard();
  renderWorkshops();
  renderParticipants();
  renderLocks();
  renderResults();
}

function runOptimization() {
  const calculated = optimizeEvent(state);
  if (!calculated.ok) {
    showDialog("Zuteilung nicht möglich", calculated.errors, "error");
    return;
  }
  result = calculated;
  resultUndoStack.length = 0;
  selectedCourseId = result.courseResults.find((course) => course.open)?.id || "";
  renderResults();
  if (calculated.warnings.length) showDialog("Zuteilung berechnet – mit Hinweisen", calculated.warnings, "warning");
  else toast("Zuteilung erfolgreich berechnet.");
  activateTab("results");
}

function activateTab(name) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.dataset.panel === name));
}

function nextId(prefix, existing) {
  for (let i = 1; i <= 9999; i += 1) {
    const id = `${prefix}${String(i).padStart(2, "0")}`;
    if (!existing.has(id)) return id;
  }
  return "";
}

function addWorkshop() {
  if (state.workshops.length >= 30) return showDialog("Grenze erreicht", "Es können höchstens 30 Durchführungen eingetragen werden.", "warning");
  const id = nextId("W", new Set(state.workshops.map((w) => w.id)));
  const offerId = nextId("K", new Set(state.workshops.map((w) => w.offerId)));
  state.workshops.push({
    id, offerId, name: "Neuer Workshop", session: "A", gradeFrom: 7, gradeTo: 12,
    schoolForm: "Alle", cohortMin: null, min: 0, max: 12, mode: state.settings.defaultMode, gradeLimits: {},
    gradeGroupRule: { enabled: false, balance: true },
  });
  commit(); renderWorkshops(); renderParticipants(); renderLocks();
}

function addParticipant() {
  if (state.participants.length >= 500) return showDialog("Grenze erreicht", "Es können höchstens 500 Teilnehmer eingetragen werden.", "warning");
  state.participants.push({
    id: nextId("P", new Set(state.participants.map((p) => p.id))), firstName: "", lastName: "", className: "7a",
    schoolForm: "Regional", wishes: ["", "", "", ""], fixed: "",
  });
  commit(); renderParticipants(); renderLocks();
}

function addLock() {
  state.locks.push({ personId: "", workshopId: "", reason: "" });
  commit(); renderLocks();
}

function handleTableChange(event) {
  const control = event.target.closest("[data-entity]");
  if (!control) return;
  const row = control.closest("tr");
  const index = Number(row?.dataset.index);
  const field = control.dataset.field;
  let value = control.value;
  if (control.type === "number") value = field === "cohortMin" && value === "" ? null : Number(value);

  if (control.dataset.entity === "workshop") state.workshops[index][field] = value;
  if (control.dataset.entity === "participant") {
    if (field.startsWith("wish")) state.participants[index].wishes[Number(field.slice(4))] = value;
    else state.participants[index][field] = value;
  }
  if (control.dataset.entity === "lock") state.locks[index][field] = value;
  commit();
}

function handleTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.closest("tr")?.dataset.index);
  if (button.dataset.action === "edit-grade-limits") {
    openGradeLimitsDialog(index);
    return;
  }
  if (button.dataset.action === "duplicate-workshop") {
    if (state.workshops.length >= 30) return showDialog("Grenze erreicht", "Es können höchstens 30 Durchführungen eingetragen werden.", "warning");
    const source = state.workshops[index];
    const copy = {
      ...source,
      gradeLimits: JSON.parse(JSON.stringify(source.gradeLimits || {})),
      gradeGroupRule: JSON.parse(JSON.stringify(source.gradeGroupRule || { enabled: false, balance: true })),
      id: nextId("W", new Set(state.workshops.map((w) => w.id))),
      session: nextSessionLabel(source.offerId),
      fixed: undefined,
    };
    state.workshops.splice(index + 1, 0, copy);
    commit(); renderWorkshops(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-workshop") {
    const removed = state.workshops[index];
    state.workshops.splice(index, 1);
    const offerStillExists = state.workshops.some((w) => w.offerId === removed.offerId);
    state.participants.forEach((p) => {
      if (!offerStillExists) p.wishes = p.wishes.map((wish) => wish === removed.offerId ? "" : wish);
      if (p.fixed === removed.id) p.fixed = "";
    });
    state.locks = state.locks.filter((lock) => lock.workshopId !== removed.id);
    commit(); renderWorkshops(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-participant") {
    const removed = state.participants[index];
    state.participants.splice(index, 1);
    state.locks = state.locks.filter((lock) => lock.personId !== removed.id);
    commit(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-lock") {
    state.locks.splice(index, 1); commit(); renderLocks();
  }
}

function exportJson() {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `${safeFilename(state.name)}.json`);
}

async function importJson(file) {
  const parsed = JSON.parse(await file.text());
  state = normalizeEvent(parsed);
  result = null;
  scheduleSave(); renderAll(); toast("JSON-Datei geladen.");
}

function getRowValue(row, aliases) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
  for (const alias of aliases) {
    const value = normalized[alias.toLowerCase()];
    if (value !== undefined && value !== null) return value;
  }
  return "";
}

function worksheetObjects(worksheet, requiredHeader) {
  if (!worksheet) return [];
  let headerRow = null;
  let headers = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRow || rowNumber > 15) return;
    const values = row.values.slice(1).map((value) => String(value ?? "").trim());
    if (values.some((value) => value.toLowerCase() === requiredHeader.toLowerCase())) {
      headerRow = rowNumber;
      headers = values;
    }
  });
  if (!headerRow) return [];
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const object = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.getCell(index + 1);
      object[header] = cell.text ?? cell.value ?? "";
    });
    rows.push(object);
  });
  return rows;
}

function parseExcelWorkbook(workbook) {
  const workshopSheet = workbook.getWorksheet("Workshops");
  const gradeLimitSheet = workbook.getWorksheet("Jahrgangsbelegung") || workbook.getWorksheet("Jahrgangsgrenzen");
  const participantSheet = workbook.getWorksheet("Kursanwahl") || workbook.getWorksheet("Personen");
  const lockSheet = workbook.getWorksheet("Sperrungen");

  let workshopRows = worksheetObjects(workshopSheet, "Durchführungs-ID");
  if (!workshopRows.length) workshopRows = worksheetObjects(workshopSheet, "Durchfuehrungs-ID");
  if (!workshopRows.length) workshopRows = worksheetObjects(workshopSheet, "Workshop-ID");
  const importedWorkshops = workshopRows.map((row) => {
    const id = String(getRowValue(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
    return {
      id,
      offerId: String(getRowValue(row, ["Kursart-ID", "Anwahl-ID", "Kurs-ID"]) || id).trim(),
      name: String(getRowValue(row, ["Kursart", "Workshopname", "Workshop", "Name"])).trim(),
      session: String(getRowValue(row, ["Gruppe", "Durchführungsgruppe", "Durchfuehrungsgruppe"])).trim(),
      gradeFrom: Number(getRowValue(row, ["Klasse von", "Von"])),
      gradeTo: Number(getRowValue(row, ["Klasse bis", "Bis"])),
      schoolForm: String(getRowValue(row, ["Bildungsgang", "Schulform"]) || "Alle").trim(),
      cohortMin: (() => { const v = getRowValue(row, ["Kohortenminimum", "Kohorte min.", "Jahrgang/Bildungsgang min."]); return v === "" ? null : Number(v); })(),
      min: Number(getRowValue(row, ["Mindestbelegung", "Minimum", "Min"])) || 0,
      max: Number(getRowValue(row, ["Maximalbelegung", "Maximum", "Max"])) || 0,
      mode: String(getRowValue(row, ["Pflicht/Optional", "Durchführung", "Durchfuehrung"]) || state.settings.defaultMode).trim(),
      gradeLimits: {},
      gradeGroupRule: {
        enabled: parseYesNo(getRowValue(row, ["Jahrgangsgruppen-Regel 8/9 + 10+", "Jahrgangsgruppen-Regel", "Vierergruppen 8/9 + 10+", "Vierergruppen", "Jugend debattiert"]), false),
        balance: parseYesNo(getRowValue(row, ["Gruppenausgleich", "Jahrgangsgruppen ausgleichen", "Wettbewerbsgruppen ausgleichen", "Ausgleich Debattiergruppen"]), true),
      },
    };
  }).filter((row) => row.id);

  const gradeLimitRows = worksheetObjects(gradeLimitSheet, "Durchführungs-ID");
  const gradeLimitMap = new Map();
  for (const row of gradeLimitRows) {
    const workshopId = String(getRowValue(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
    const grade = Number(getRowValue(row, ["Jahrgang", "Klassenstufe", "Jg."]));
    const rawMin = getRowValue(row, ["Minimum", "Min", "Mindestens"]);
    const rawMax = getRowValue(row, ["Maximum", "Max", "Höchstens", "Hoechstens"]);
    const min = normalizeNullableLimit(rawMin);
    const max = normalizeNullableLimit(rawMax);
    if (!workshopId || !Number.isInteger(grade) || grade < 1 || grade > 20 || (min === null && max === null)) continue;
    if (!gradeLimitMap.has(workshopId)) gradeLimitMap.set(workshopId, {});
    gradeLimitMap.get(workshopId)[String(grade)] = { min, max };
  }
  importedWorkshops.forEach((workshop) => { workshop.gradeLimits = gradeLimitMap.get(workshop.id) || {}; });

  const participants = worksheetObjects(participantSheet, "Person-ID").map((row) => ({
    id: String(getRowValue(row, ["Person-ID", "ID"])).trim(),
    firstName: String(getRowValue(row, ["Vorname"])).trim(),
    lastName: String(getRowValue(row, ["Nachname"])).trim(),
    className: String(getRowValue(row, ["Klasse"])).trim(),
    schoolForm: String(getRowValue(row, ["Bildungsgang", "Schulform"]) || "Regional").trim(),
    wishes: ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"].map((key) => String(getRowValue(row, [key])).trim()),
    fixed: String(getRowValue(row, ["Feste Setzung"])).trim(),
  })).filter((row) => row.id);

  const importedLocks = worksheetObjects(lockSheet, "Person-ID").map((row) => ({
    personId: String(getRowValue(row, ["Person-ID", "Person"])).trim(),
    workshopId: String(getRowValue(row, ["Workshop-ID", "Workshop"])).trim(),
    reason: String(getRowValue(row, ["Grund / Hinweis", "Grund", "Hinweis"])).trim(),
  })).filter((row) => row.personId || row.workshopId);

  if (!participants.length) throw new Error("Das Blatt „Kursanwahl“ oder „Personen“ wurde nicht erkannt oder enthält keine Person-IDs.");

  const workshops = importedWorkshops.length ? importedWorkshops : state.workshops;
  const locks = lockSheet ? importedLocks : state.locks;
  if (!workshops.length) throw new Error("Es sind keine Workshops vorhanden. Bitte zuerst Workshops anlegen oder ein Blatt „Workshops“ mit importieren.");
  return normalizeEvent({ ...state, workshops, participants, locks });
}

async function importExcel(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  state = parseExcelWorkbook(workbook);
  result = null; scheduleSave(); renderAll(); toast("Excel-Datei importiert.");
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  worksheet.columns.forEach((column) => {
    let width = 12;
    column.eachCell({ includeEmpty: true }, (cell) => { width = Math.min(38, Math.max(width, String(cell.text ?? "").length + 2)); });
    column.width = width;
  });
}

async function exportExcel() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Workshop-Zuteilung";
  const addTableSheet = (name, columns, rows) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns.map(([header, key]) => ({ header, key }));
    worksheet.addRows(rows);
    styleWorksheet(worksheet);
  };
  addTableSheet("Workshops", [
    ["Durchführungs-ID", "id"], ["Kursart-ID", "offerId"], ["Kursart", "name"], ["Gruppe", "session"],
    ["Klasse von", "gradeFrom"], ["Klasse bis", "gradeTo"], ["Bildungsgang", "schoolForm"], ["Kohortenminimum", "cohortMin"],
    ["Mindestbelegung", "min"], ["Maximalbelegung", "max"], ["Jahrgangsgruppen-Regel 8/9 + 10+", "gradeGroupEnabled"],
    ["Gruppenausgleich", "gradeGroupBalance"], ["Pflicht/Optional", "mode"],
  ], state.workshops.map((workshop) => ({
    ...workshop,
    gradeGroupEnabled: workshop.gradeGroupRule?.enabled ? "Ja" : "Nein",
    gradeGroupBalance: workshop.gradeGroupRule?.balance !== false ? "Ja" : "Nein",
  })));
  addTableSheet("Jahrgangsbelegung", [
    ["Durchführungs-ID", "workshopId"], ["Jahrgang", "grade"], ["Minimum", "min"], ["Maximum", "max"],
  ], state.workshops.flatMap((workshop) => gradeLimitEntriesForWorkshop(workshop).map((limit) => ({ workshopId: workshop.id, grade: limit.grade, min: limit.min ?? "", max: limit.max ?? "" }))));
  addTableSheet("Personen", [
    ["Person-ID", "id"], ["Vorname", "firstName"], ["Nachname", "lastName"], ["Klasse", "className"], ["Bildungsgang", "schoolForm"],
    ["Erstwunsch", "wish1"], ["Zweitwunsch", "wish2"], ["Drittwunsch", "wish3"], ["Viertwunsch", "wish4"], ["Feste Setzung", "fixed"],
  ], state.participants.map((p) => ({ ...p, wish1: p.wishes[0], wish2: p.wishes[1], wish3: p.wishes[2], wish4: p.wishes[3] })));
  addTableSheet("Sperrungen", [["Person-ID", "personId"], ["Durchführungs-ID", "workshopId"], ["Grund / Hinweis", "reason"]], state.locks);
  if (result?.ok) {
    addTableSheet("Ergebnis", [["Nachname", "lastName"], ["Vorname", "firstName"], ["Klasse", "className"], ["Workshop", "workshopName"], ["Zuteilungsart", "type"], ["Hinweis", "note"]], result.participantResults);
    addTableSheet("Kursübersicht", [["Kursart", "name"], ["Gruppe", "session"], ["Pflicht/Optional", "mode"], ["Kohortenminimum", "cohortMinEffective"], ["Minimum", "effectiveMin"], ["Ziel", "target"], ["Belegung", "load"], ["Maximum", "max"], ["Abweichung", "deviation"], ["Jahrgangsgruppe 8–9", "gradeGroupSekI"], ["Jahrgangsgruppe 10+", "gradeGroupSekII"], ["Gruppendifferenz", "gradeGroupImbalanceExport"], ["Regelhinweise", "ruleHintsExport"], ["Status", "status"]], result.courseResults.map((course) => ({
      ...course,
      gradeGroupSekI: course.gradeGroupSummary?.find((item) => item.key === "sekI")?.count ?? "",
      gradeGroupSekII: course.gradeGroupSummary?.find((item) => item.key === "sekII")?.count ?? "",
      gradeGroupImbalanceExport: course.gradeGroupRule?.enabled && course.gradeGroupRule?.balance !== false ? course.gradeGroupImbalance : "",
      ruleHintsExport: (course.ruleHints || []).join("; "),
    })));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(state.name)}.xlsx`);
}

function ensureResult() {
  if (result?.ok) return true;
  showDialog("Noch kein Ergebnis", "Bitte zuerst die Zuteilung berechnen.", "warning");
  return false;
}

function addPdfHeader(doc, title, subtitle) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(title, 14, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(subtitle, 14, 25);
}

async function exportCoursePdfs() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  for (const course of result.courseResults.filter((c) => c.open)) {
    const persons = result.participantResults
      .filter((p) => p.workshopId === course.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const doc = new jsPDF({ format: "a4", unit: "mm" });
    addPdfHeader(doc, `Teilnehmerliste: ${workshopLabel(course)}`, `Klasse ${course.gradeFrom}–${course.gradeTo} · Belegung ${course.load} · Ziel ${course.target} · Maximum ${course.max} · Kohorte min. ${course.cohortMinEffective || "aus"}`);
    autoTable(doc, {
      startY: 31,
      head: [["Nr.", "Nachname", "Vorname", "Klasse", "Zuteilungsart"]],
      body: persons.map((p, i) => [i + 1, p.lastName, p.firstName, String(p.className), p.type]),
      styles: { font: "helvetica", fontSize: 9 },
      headStyles: { fillColor: [31, 78, 120] },
    });
    zip.file(`${safeFilename(workshopLabel(course))}.pdf`, doc.output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Kurslisten.zip`);
}

async function exportClassPdfs() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  const classes = [...new Set(result.participantResults.map((p) => p.className))].sort((a, b) => String(a).localeCompare(String(b), "de", { numeric: true }));
  for (const className of classes) {
    const persons = result.participantResults
      .filter((p) => p.className === className)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const doc = new jsPDF({ format: "a4", unit: "mm" });
    addPdfHeader(doc, `Klassenliste: ${className}`, "Alphabetisch nach Nachname und Vorname");
    autoTable(doc, {
      startY: 31,
      head: [["Nr.", "Nachname", "Vorname", "Workshop", "Zuteilungsart"]],
      body: persons.map((p, i) => [i + 1, p.lastName, p.firstName, p.workshopName || "Nicht zugeteilt", p.type]),
      styles: { font: "helvetica", fontSize: 9 },
      headStyles: { fillColor: [31, 78, 120] },
    });
    zip.file(`Klasse_${safeFilename(className)}.pdf`, doc.output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Klassenlisten.zip`);
}


function docxEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function docxParagraph(text, { bold = false, size = 20, after = 0 } = {}) {
  const runProps = `${bold ? "<w:b/>" : ""}<w:sz w:val=\"${size}\"/><w:szCs w:val=\"${size}\"/>`;
  return `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${docxEscape(text)}</w:t></w:r></w:p>`;
}

function docxCell(value, { header = false } = {}) {
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="D9EAF7"/>' : "";
  return `<w:tc><w:tcPr>${shading}</w:tcPr>${docxParagraph(value, { bold: header, size: 18 })}</w:tc>`;
}

function docxTable(headers, rows) {
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C9D6"/><w:left w:val="single" w:sz="4" w:color="B7C9D6"/><w:bottom w:val="single" w:sz="4" w:color="B7C9D6"/><w:right w:val="single" w:sz="4" w:color="B7C9D6"/><w:insideH w:val="single" w:sz="4" w:color="D9E2E8"/><w:insideV w:val="single" w:sz="4" w:color="D9E2E8"/></w:tblBorders>`;
  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((value) => docxCell(value, { header: true })).join("")}</w:tr>`;
  const bodyRows = rows.map((row) => `<w:tr>${row.map((value) => docxCell(value)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>${borders}</w:tblPr>${headerRow}${bodyRows}</w:tbl>`;
}

async function createDocxFile({ title, subtitle, headers, rows }) {
  const file = new JSZip();
  file.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  file.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const word = file.folder("word");
  word.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`);
  word.folder("_rels").file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  word.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${docxParagraph(title, { bold: true, size: 30, after: 80 })}
    ${docxParagraph(subtitle, { size: 18, after: 160 })}
    ${docxTable(headers, rows)}
    <w:p>${docxParagraph("· © 2026 Oliver Richter", { size: 16 }).replace(/^<w:p>|<\/w:p>$/g, "")}</w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`);
  return file.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function exportCourseDocx() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  for (const course of result.courseResults.filter((c) => c.open)) {
    const persons = result.participantResults
      .filter((p) => p.workshopId === course.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const docx = await createDocxFile({
      title: `Teilnehmerliste: ${workshopLabel(course)}`,
      subtitle: `Belegung ${course.load} · Ziel ${course.target} · Minimum ${course.effectiveMin} · Maximum ${course.max}`,
      headers: ["Nr.", "Nachname", "Vorname", "Klasse", "Zuteilungsart"],
      rows: persons.map((person, index) => [index + 1, person.lastName, person.firstName, String(person.className), person.type]),
    });
    zip.file(`${safeFilename(workshopLabel(course))}.docx`, docx);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Kurslisten_Word.zip`);
}

async function exportClassDocx() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  const classes = [...new Set(result.participantResults.map((p) => p.className))]
    .sort((a, b) => String(a).localeCompare(String(b), "de", { numeric: true }));
  for (const className of classes) {
    const persons = result.participantResults
      .filter((p) => p.className === className)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const docx = await createDocxFile({
      title: `Klassenliste: ${className}`,
      subtitle: "Alphabetisch nach Nachname und Vorname",
      headers: ["Nr.", "Nachname", "Vorname", "Workshop", "Zuteilungsart"],
      rows: persons.map((person, index) => [index + 1, person.lastName, person.firstName, person.workshopName || "Nicht zugeteilt", person.type]),
    });
    zip.file(`Klasse_${safeFilename(className)}.docx`, docx);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Klassenlisten_Word.zip`);
}


async function downloadCourseChoiceTemplate() {
  if (!state.workshops.length) return showDialog("Keine Workshops", "Bitte zuerst Workshops anlegen.", "warning");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Workshop-Zuteilung";

  const guide = workbook.addWorksheet("Anleitung");
  guide.addRow(["Workshop-Zuteilung – vollständige Importvorlage"]);
  guide.addRow([]);
  guide.addRow(["Blatt", "Verwendung"]);
  guide.addRow(["Workshops", "Kurse und Durchführungen einschließlich Klassenbereich, Bildungsgang, Kohortenminimum, Mindest-/Maximalbelegung und optionaler Jahrgangsgruppen-Regel pflegen. Beim Import ersetzen diese Angaben die Workshops im aktuellen Projekt."]);
  guide.addRow(["Jahrgangsbelegung", "Optionale Mindest- und Höchstzahlen je Jahrgang und Durchführung. Sie werden bestmöglich erfüllt; leere Felder bedeuten keine Vorgabe."]);
  guide.addRow(["Kursanwahl", "Teilnehmerdaten und vier Wünsche erfassen. Die Wünsche beziehen sich auf die Kursart-ID; die feste Setzung auf die konkrete Durchführungs-ID."]);
  guide.addRow(["Sperrungen", "Unerlaubte Kombinationen aus Person-ID und Durchführungs-ID eintragen. Ein vorhandenes Blatt Sperrungen ersetzt beim Import die Sperrungen des aktuellen Projekts."]);
  guide.addRow([]);
  guide.addRow(["Kohortenminimum", "Leer = globaler Wert der Anwendung, 0 = aus, ab 2 = eigener vorrangiger Zielwert für diese Durchführung."]);
  guide.addRow(["Jahrgangsbelegung", "Beispiel: Jahrgang 8 Minimum 7 = mindestens 7 Achtklässler müssen in diesem Kurs sein. Nur Maximum 4 = höchstens 4. Leer = keine Vorgabe."]);
  guide.addRow(["Jahrgangsgruppen-Regel 8/9 + 10+", "Ja = Jahrgänge 8+9 sowie Jahrgang 10 aufwärts sollen jeweils mit einer durch 4 teilbaren Schülerzahl vertreten sein. Ist das nicht vollständig möglich, wird trotzdem zugeteilt und die kleinste Abweichung angezeigt. Gruppenausgleich Ja = beide Jahrgangsgruppen sollen zusätzlich möglichst gleich groß sein."]);
  guide.addRow(["Hinweis", "Die Vorlage enthält die aktuell im Projekt eingetragenen Workshops, Jahrgangsvorgaben und Sperrungen. Änderungen können direkt in Excel vorgenommen und anschließend wieder importiert werden."]);
  guide.getColumn(1).width = 24;
  guide.getColumn(2).width = 110;
  guide.getRow(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  guide.getRow(3).font = { bold: true };

  const workshops = workbook.addWorksheet("Workshops");
  workshops.columns = [
    { header: "Durchführungs-ID", key: "id", width: 20 },
    { header: "Kursart-ID", key: "offerId", width: 16 },
    { header: "Kursart", key: "name", width: 30 },
    { header: "Gruppe", key: "session", width: 12 },
    { header: "Klasse von", key: "gradeFrom", width: 12 },
    { header: "Klasse bis", key: "gradeTo", width: 12 },
    { header: "Bildungsgang", key: "schoolForm", width: 16 },
    { header: "Kohortenminimum", key: "cohortMin", width: 18 },
    { header: "Mindestbelegung", key: "min", width: 18 },
    { header: "Maximalbelegung", key: "max", width: 18 },
    { header: "Jahrgangsgruppen-Regel 8/9 + 10+", key: "gradeGroupEnabled", width: 34 },
    { header: "Gruppenausgleich", key: "gradeGroupBalance", width: 20 },
    { header: "Pflicht/Optional", key: "mode", width: 18 },
  ];
  workshops.addRows(state.workshops.map((w) => ({
    id: w.id,
    offerId: w.offerId || w.id,
    name: w.name,
    session: w.session || "",
    gradeFrom: w.gradeFrom ?? "",
    gradeTo: w.gradeTo ?? "",
    schoolForm: w.schoolForm || "Alle",
    cohortMin: w.cohortMin ?? "",
    min: w.min ?? 0,
    max: w.max ?? 0,
    gradeGroupEnabled: w.gradeGroupRule?.enabled ? "Ja" : "Nein",
    gradeGroupBalance: w.gradeGroupRule?.balance !== false ? "Ja" : "Nein",
    mode: w.mode || state.settings.defaultMode,
  })));
  while (workshops.rowCount < 31) workshops.addRow({});
  styleWorksheet(workshops);
  for (let row = 2; row <= 31; row += 1) {
    workshops.getCell(row, 7).dataValidation = { type: "list", allowBlank: false, formulae: ['"Alle,Regional,Gymnasial"'] };
    workshops.getCell(row, 11).dataValidation = { type: "list", allowBlank: false, formulae: ['"Ja,Nein"'] };
    workshops.getCell(row, 12).dataValidation = { type: "list", allowBlank: false, formulae: ['"Ja,Nein"'] };
    workshops.getCell(row, 13).dataValidation = { type: "list", allowBlank: false, formulae: ['"Pflicht,Optional"'] };
  }

  const gradeLimitsSheet = workbook.addWorksheet("Jahrgangsbelegung");
  gradeLimitsSheet.columns = [
    { header: "Durchführungs-ID", key: "workshopId", width: 22 },
    { header: "Jahrgang", key: "grade", width: 12 },
    { header: "Minimum", key: "min", width: 14 },
    { header: "Maximum", key: "max", width: 14 },
  ];
  for (const workshop of state.workshops) {
    const from = Math.max(1, Math.min(20, Number(workshop.gradeFrom) || 1));
    const to = Math.max(from, Math.min(20, Number(workshop.gradeTo) || from));
    for (let grade = from; grade <= to; grade += 1) {
      const limit = workshop.gradeLimits?.[String(grade)] || {};
      gradeLimitsSheet.addRow({ workshopId: workshop.id, grade, min: limit.min ?? "", max: limit.max ?? "" });
    }
  }
  styleWorksheet(gradeLimitsSheet);

  const sheet = workbook.addWorksheet("Kursanwahl");
  sheet.columns = [
    ["Person-ID", 16], ["Vorname", 20], ["Nachname", 22], ["Klasse", 12], ["Bildungsgang", 16],
    ["Erstwunsch", 18], ["Zweitwunsch", 18], ["Drittwunsch", 18], ["Viertwunsch", 18], ["Feste Setzung", 20],
  ].map(([header, width]) => ({ header, width }));
  for (let i = 0; i < 500; i += 1) sheet.addRow({});
  styleWorksheet(sheet);
  for (let row = 2; row <= 501; row += 1) {
    sheet.getCell(row, 5).dataValidation = { type: "list", allowBlank: false, formulae: ['"Regional,Gymnasial"'] };
    for (let col = 6; col <= 9; col += 1) {
      sheet.getCell(row, col).dataValidation = { type: "list", allowBlank: true, formulae: ["'Workshops'!$B$2:$B$31"] };
    }
    sheet.getCell(row, 10).dataValidation = { type: "list", allowBlank: true, formulae: ["'Workshops'!$A$2:$A$31"] };
  }

  const locks = workbook.addWorksheet("Sperrungen");
  locks.columns = [
    { header: "Person-ID", key: "personId", width: 18 },
    { header: "Durchführungs-ID", key: "workshopId", width: 22 },
    { header: "Grund / Hinweis", key: "reason", width: 42 },
  ];
  locks.addRows((state.locks || []).map((lock) => ({
    personId: lock.personId,
    workshopId: lock.workshopId,
    reason: lock.reason || "",
  })));
  while (locks.rowCount < 501) locks.addRow({});
  styleWorksheet(locks);
  for (let row = 2; row <= 501; row += 1) {
    locks.getCell(row, 1).dataValidation = { type: "list", allowBlank: true, formulae: ["'Kursanwahl'!$A$2:$A$501"] };
    locks.getCell(row, 2).dataValidation = { type: "list", allowBlank: true, formulae: ["'Workshops'!$A$2:$A$31"] };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(state.name)}_Importvorlage.xlsx`);
}

function bindEvents() {
  $("#tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) activateTab(button.dataset.tab);
  });
  $("#eventName").addEventListener("input", (event) => { state.name = event.target.value; commit({ invalidate: false }); });
  $("#allowOutside").addEventListener("change", (event) => { state.settings.allowOutside = event.target.value === "true"; commit(); });
  $("#defaultMode").addEventListener("change", (event) => { state.settings.defaultMode = event.target.value; commit({ invalidate: false }); });
  $("#balanceLevel").addEventListener("change", (event) => { state.settings.balanceWeight = Number(event.target.value) || 0; commit(); });
  $("#balanceThreshold").addEventListener("change", (event) => { state.settings.balanceThreshold = Math.max(0, Number(event.target.value) || 0); commit(); });
  $("#qualityMode").addEventListener("change", (event) => { state.settings.qualityMode = event.target.value; commit(); });
  $("#gradePreferenceWeight").addEventListener("input", (event) => updateGradePreferenceWeightOutput(event.target.value));
  $("#gradePreferenceWeight").addEventListener("change", (event) => {
    state.settings.gradePreferenceWeight = Math.max(0, Math.min(100, Number(event.target.value) || 0));
    commit();
  });
  $("#addRuleBtn").addEventListener("click", addRule);
  $("#rulesTable").addEventListener("change", handleRuleChange);
  $("#rulesTable").addEventListener("click", handleRuleClick);
  $("#gradeLimitsSaveBtn").addEventListener("click", saveGradeLimitsDialog);
  $("#gradeLimitsCancelBtn").addEventListener("click", () => $("#gradeLimitsDialog").close());
  $("#debateRuleEnabled").addEventListener("change", (event) => {
    $("#debateBalanceEnabled").disabled = !event.target.checked;
  });
  $("#workshopsTable").addEventListener("change", handleTableChange);
  $("#participantsTable").addEventListener("change", handleTableChange);
  $("#locksTable").addEventListener("change", handleTableChange);
  $("#workshopsTable").addEventListener("click", handleTableClick);
  $("#participantsTable").addEventListener("click", handleTableClick);
  $("#locksTable").addEventListener("click", handleTableClick);
  $("#participantSearch").addEventListener("input", renderParticipants);
  $("#addWorkshopBtn").addEventListener("click", addWorkshop);
  $("#addParticipantBtn").addEventListener("click", addParticipant);
  $("#addLockBtn").addEventListener("click", addLock);
  $("#optimizeBtn").addEventListener("click", runOptimization);
  $("#optimizeBtnSecondary").addEventListener("click", runOptimization);
  $("#courseResultsTable").addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-course-detail"]');
    const row = event.target.closest("tr[data-course-id]");
    const id = button?.dataset.courseId || row?.dataset.courseId;
    if (id) openCourseDetail(id);
  });
  $("#courseDetailSelect").addEventListener("change", (event) => { selectedCourseId = event.target.value; renderCourseDetail(); });
  $("#prevCourseBtn").addEventListener("click", () => { const courses=result?.courseResults?.filter(c=>c.open)||[]; const i=courses.findIndex(c=>c.id===selectedCourseId); if(courses.length){selectedCourseId=courses[(i-1+courses.length)%courses.length].id;renderCourseDetail();} });
  $("#nextCourseBtn").addEventListener("click", () => { const courses=result?.courseResults?.filter(c=>c.open)||[]; const i=courses.findIndex(c=>c.id===selectedCourseId); if(courses.length){selectedCourseId=courses[(i+1)%courses.length].id;renderCourseDetail();} });
  $("#undoMoveBtn").addEventListener("click", () => { if(resultUndoStack.length){result=resultUndoStack.pop();renderResults();renderCourseDetail();toast("Letzte manuelle Änderung rückgängig gemacht.");} });
  $("#courseDetailDialog").addEventListener("click", (event) => {
    const tab=event.target.closest("[data-detail-tab]"); if(tab){courseDetailTab=tab.dataset.detailTab;renderCourseDetail();return;}
    const action=event.target.closest("[data-action]"); if(!action)return;
    if(action.dataset.action==="move-person"){const id=action.dataset.personId;const select=$("[data-move-person='"+CSS.escape(id)+"']");if(select?.value)moveParticipant(id,select.value);}
    if(action.dataset.action==="fix-person") fixParticipant(action.dataset.personId);
    if(action.dataset.action==="apply-swap") applySwap(action.dataset.a,action.dataset.b);
  });
  $("#sampleBtn").addEventListener("click", () => {
    if (!confirm("Aktuelle Daten durch die Beispieldaten ersetzen?")) return;
    state = createSampleData(); result = null; scheduleSave(); renderAll(); toast("Beispieldaten geladen.");
  });
  $("#deleteProjectBtn").addEventListener("click", deleteCurrentProject);
  $("#jsonExportBtn").addEventListener("click", exportJson);
  $("#jsonImportBtn").addEventListener("click", () => $("#jsonFile").click());
  $("#templateBtn").addEventListener("click", downloadCourseChoiceTemplate);
  $("#excelImportBtn").addEventListener("click", () => $("#excelFile").click());
  $("#excelExportBtn").addEventListener("click", exportExcel);
  $("#coursePdfBtn").addEventListener("click", exportCoursePdfs);
  $("#classPdfBtn").addEventListener("click", exportClassPdfs);
  $("#courseDocxBtn").addEventListener("click", exportCourseDocx);
  $("#classDocxBtn").addEventListener("click", exportClassDocx);
  $("#jsonFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importJson(event.target.files[0]); }
    catch (error) { showDialog("JSON-Import fehlgeschlagen", error.message); }
    event.target.value = "";
  });
  $("#excelFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importExcel(event.target.files[0]); }
    catch (error) { showDialog("Excel-Import fehlgeschlagen", error.message); }
    event.target.value = "";
  });
}

bindEvents();
renderAll();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
