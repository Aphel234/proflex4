const MODES = new Set(["Pflicht", "Optional"]);
const FORMS = new Set(["Alle", "Regional", "Gymnasial"]);
const GRADE_GROUP_SIZE = 4;
const GRADE_GROUPS = Object.freeze([
  { key: "sekI", label: "Sek I (Jahrgänge 8–9)", gradeFrom: 8, gradeTo: 9 },
  { key: "sekII", label: "Sek II (Jahrgang 10 aufwärts)", gradeFrom: 10, gradeTo: 20 },
]);

export function parseGrade(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})/);
  return match ? Number(match[1]) : NaN;
}

function nullableCount(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(500, Math.trunc(number)));
}

function normalizeGradeLimits(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [rawGrade, value] of Object.entries(raw)) {
    const grade = Number(rawGrade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 20) continue;
    const min = nullableCount(value?.min);
    const max = nullableCount(value?.max);
    if (min === null && max === null) continue;
    result[String(grade)] = { min, max };
  }
  return result;
}

function normalizeGradeGroupRule(raw) {
  if (raw === true) return { enabled: true, balance: true };
  return {
    enabled: raw?.enabled === true,
    balance: raw?.balance !== false,
  };
}

function gradeGroupForGrade(grade) {
  return GRADE_GROUPS.find((group) => grade >= group.gradeFrom && grade <= group.gradeTo) || null;
}

function gradeGroupCountsForPeople(people) {
  const counts = new Map(GRADE_GROUPS.map((group) => [group.key, 0]));
  for (const person of people || []) {
    const group = gradeGroupForGrade(parseGrade(person.className));
    if (group) counts.set(group.key, (counts.get(group.key) || 0) + 1);
  }
  return counts;
}

function gradeGroupSummaryForPeople(course, people) {
  if (!course?.gradeGroupRule?.enabled) return [];
  const counts = gradeGroupCountsForPeople(people);
  return GRADE_GROUPS.map((group) => {
    const count = counts.get(group.key) || 0;
    return {
      key: group.key,
      label: group.label,
      count,
      groupSize: GRADE_GROUP_SIZE,
      remainder: count % GRADE_GROUP_SIZE,
    };
  });
}

function gradeGroupViolationsForPeople(course, people) {
  return gradeGroupSummaryForPeople(course, people)
    .filter((item) => item.remainder !== 0)
    .map((item) => ({
      kind: "debateModulo",
      course,
      ...item,
      distance: Math.min(item.remainder, GRADE_GROUP_SIZE - item.remainder),
    }));
}

function gradeGroupImbalanceForPeople(course, people) {
  if (!course?.gradeGroupRule?.enabled || !course.gradeGroupRule.balance) return 0;
  const summary = gradeGroupSummaryForPeople(course, people);
  return summary.length === 2 ? Math.abs(summary[0].count - summary[1].count) : 0;
}

function gradeLimitEntries(course) {
  return Object.entries(course?.gradeLimits || {})
    .map(([grade, limit]) => ({ grade: Number(grade), min: nullableCount(limit?.min), max: nullableCount(limit?.max) }))
    .filter((item) => Number.isInteger(item.grade) && item.grade >= 1 && item.grade <= 20)
    .sort((a, b) => a.grade - b.grade);
}

function gradeMinimumTotal(course) {
  return gradeLimitEntries(course).reduce((sum, item) => sum + (item.min ?? 0), 0);
}

function courseGradeMaximum(course, grade) {
  const limit = course?.gradeLimits?.[String(grade)];
  const configured = nullableCount(limit?.max);
  return configured === null ? course.max : Math.min(course.max, configured);
}

export function normalizeEvent(input) {
  const settings = {
    allowOutside: false,
    defaultMode: "Pflicht",
    balanceWeight: 10,
    balanceThreshold: 10,
    cohortMin: 0,
    qualityMode: "standard",
    gradePreferenceWeight: 50,
    gradeLimitsRelaxed: false,
    rules: [],
    ...(input?.settings ?? {}),
  };

  const normalizedCohortMin = Number(settings.cohortMin);
  const rawRules = Array.isArray(settings.rules) ? settings.rules : [];
  const ruleTypes = new Set(["class", "grade", "gradeForm", "gradeAnyForm"]);
  const normalizedRules = rawRules.map((rule, index) => ({
    id: String(rule?.id || `R${index + 1}`),
    type: ruleTypes.has(rule?.type) ? rule.type : "gradeForm",
    min: Math.max(2, Math.min(20, Number(rule?.min) || 2)),
    mode: rule?.mode === "hard" ? "hard" : "preferred",
    enabled: rule?.enabled !== false,
  }));

  return {
    name: String(input?.name || "Workshop-Veranstaltung"),
    settings: {
      allowOutside: Boolean(settings.allowOutside),
      defaultMode: MODES.has(settings.defaultMode) ? settings.defaultMode : "Pflicht",
      balanceWeight: Math.max(0, Math.min(500, Number(settings.balanceWeight) || 0)),
      balanceThreshold: Math.max(0, Math.min(500, Number(settings.balanceThreshold) || 0)),
      cohortMin: normalizedCohortMin === 0 ? 0 : Math.max(2, Math.min(20, Number.isFinite(normalizedCohortMin) ? normalizedCohortMin : 0)),
      qualityMode: ["fast", "standard", "thorough"].includes(settings.qualityMode) ? settings.qualityMode : "standard",
      gradePreferenceWeight: Math.max(0, Math.min(100, Number.isFinite(Number(settings.gradePreferenceWeight)) ? Number(settings.gradePreferenceWeight) : 50)),
      gradeLimitsRelaxed: settings.gradeLimitsRelaxed === true,
      rules: normalizedRules,
    },
    workshops: (input?.workshops ?? []).map((w) => {
      const id = String(w.id ?? "").trim();
      const offerId = String(w.offerId ?? w.courseTypeId ?? w.choiceId ?? id).trim();
      const rawCohortMin = w.cohortMin;
      return {
        id,
        offerId,
        name: String(w.name ?? "").trim(),
        session: String(w.session ?? w.group ?? "").trim(),
        gradeFrom: Number(w.gradeFrom),
        gradeTo: Number(w.gradeTo),
        schoolForm: FORMS.has(w.schoolForm) ? w.schoolForm : "Alle",
        min: Math.max(0, Number(w.min) || 0),
        max: Math.max(0, Number(w.max) || 0),
        mode: MODES.has(w.mode) ? w.mode : settings.defaultMode,
        cohortMin: rawCohortMin === "" || rawCohortMin === null || rawCohortMin === undefined
          ? null
          : Math.max(0, Math.min(20, Number(rawCohortMin) || 0)),
        gradeLimits: normalizeGradeLimits(w.gradeLimits),
        // Neue Projekte verwenden den neutralen Namen. Das alte Feld bleibt beim
        // Import als Alias erhalten, damit vorhandene JSON-Projekte weiterlaufen.
        gradeGroupRule: normalizeGradeGroupRule(w.gradeGroupRule ?? w.debateRule),
        _gradeLimitsRelaxed: settings.gradeLimitsRelaxed === true,
      };
    }),
    participants: (input?.participants ?? []).map((p) => ({
      id: String(p.id ?? "").trim(),
      firstName: String(p.firstName ?? "").trim(),
      lastName: String(p.lastName ?? "").trim(),
      className: String(p.className ?? "").trim(),
      schoolForm: p.schoolForm === "Gymnasial" ? "Gymnasial" : "Regional",
      wishes: Array.from({ length: 4 }, (_, i) => String(p.wishes?.[i] ?? "").trim()),
      fixed: String(p.fixed ?? "").trim(),
    })),
    locks: (input?.locks ?? []).map((l) => ({
      personId: String(l.personId ?? "").trim(),
      workshopId: String(l.workshopId ?? "").trim(),
      reason: String(l.reason ?? "").trim(),
    })),
  };
}

function effectiveMinimum(course, isOpen = true) {
  if (!isOpen) return 0;
  // Nur die gesamte Kursmindestbelegung ist eine absolute Untergrenze.
  // Jahrgangs-Minima beschreiben die gewünschte Zusammensetzung und dürfen
  // einen Kurs weder künstlich vergrößern noch die Zuteilung blockieren.
  return Math.max(course.min, course.mode === "Pflicht" ? 1 : 0);
}

function effectiveCohortMinimum(event, course) {
  const value = course.cohortMin === null ? event.settings.cohortMin : course.cohortMin;
  if (!value) return 0;
  return Math.max(2, value);
}

function cohortKey(person) {
  return `${parseGrade(person.className)}\u0000${person.schoolForm}`;
}

function cohortLabelFromKey(key) {
  const [grade, form] = String(key).split("\u0000");
  return `Jahrgang ${grade} / ${form}`;
}

function rankIndex(person, course) {
  if (!course) return -1;
  return person.wishes.findIndex((wish) => wish === course.offerId);
}

export function rankLabel(person, course) {
  if (!course) return "Nicht zugeteilt";
  if (person.fixed === course.id) return "Feste Setzung";
  const index = rankIndex(person, course);
  return ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"][index] ?? "Kein Wunsch";
}

// Wunschkosten sind bewusst stark gestaffelt.
// Eine einzige schlechtere Wunschstufe soll nicht durch viele kleine Vorteile
// beim Kursausgleich aufgewogen werden können. Bei maximal 500 Personen gilt:
// - Drittwunsch ist eine Notlösung gegenüber Erst-/Zweitwunsch.
// - Viertwunsch ist eine deutlich stärkere Notlösung.
// - außerhalb der Wünsche ist noch einmal wesentlich schlechter.
const PREFERENCE_COST = Object.freeze({
  first: 0,
  second: 1_000_000,
  third: 1_000_000_000,
  fourth: 1_000_000_000_000,
  outside: 2_000_000_000_000,
  unassigned: 5_000_000_000_000,
});

function rankBucket(person, course) {
  const index = rankIndex(person, course);
  return index >= 0 ? index : 4;
}

function preferenceCost(person, course) {
  if (person.fixed === course.id) return 0;
  const index = rankBucket(person, course);
  if (index === 0) return PREFERENCE_COST.first;
  if (index === 1) return PREFERENCE_COST.second;
  if (index === 2) return PREFERENCE_COST.third;
  if (index === 3) return PREFERENCE_COST.fourth;
  return PREFERENCE_COST.outside;
}

function badWishMarginalPenalty(rank, ordinal) {
  // Nur als Tie-Breaker innerhalb derselben Wunschqualität:
  // weitere Dritt-/Viertwünsche im selben Kurs werden zunehmend teurer.
  // Die Summen bleiben deutlich kleiner als der Sprung zur nächsten Wunschstufe.
  if (rank === 2) return ordinal * 100;
  if (rank === 3) return ordinal * 100_000;
  return 0;
}

function rankCountsFromAssignments(event, assignments, courseMap) {
  const counts = new Map();
  for (const courseId of courseMap.keys()) counts.set(courseId, [0, 0, 0, 0, 0]);
  const personMap = new Map(event.participants.map((person) => [person.id, person]));
  for (const [personId, courseId] of assignments) {
    if (!courseId || !courseMap.has(courseId)) continue;
    const person = personMap.get(personId);
    if (!person || person.fixed === courseId) continue;
    const bucket = rankBucket(person, courseMap.get(courseId));
    counts.get(courseId)[bucket] += 1;
  }
  return counts;
}

function courseEligible(person, course, lockSet, allowOutside) {
  const grade = parseGrade(person.className);
  if (!Number.isFinite(grade)) return false;
  if (grade < course.gradeFrom || grade > course.gradeTo) return false;
  if (course.schoolForm !== "Alle" && person.schoolForm !== course.schoolForm) return false;
  if (lockSet.has(`${person.id}\u0000${course.id}`)) return false;
  if (person.fixed) return person.fixed === course.id;
  return allowOutside || person.wishes.includes(course.offerId);
}

export function validateEvent(raw) {
  const event = normalizeEvent(raw);
  const errors = [];
  const warnings = [];
  const courseMap = new Map();
  const offerMap = new Map();
  const personMap = new Map();
  const lockSet = new Set();

  if (event.participants.length > 500) errors.push("Es sind mehr als 500 Teilnehmer eingetragen.");
  if (event.workshops.length > 30) errors.push("Es sind mehr als 30 Durchführungen eingetragen.");
  if (!event.workshops.length) errors.push("Es ist kein Workshop eingetragen.");
  if (!event.participants.length) errors.push("Es ist kein Teilnehmer eingetragen.");

  event.workshops.forEach((course, index) => {
    const where = `Workshop-Zeile ${index + 1}`;
    if (!course.id) errors.push(`${where}: Durchführungs-ID fehlt.`);
    if (!course.offerId) errors.push(`${where}: Kursart-ID fehlt.`);
    if (!course.name) errors.push(`${where}: Kursart/Workshopname fehlt.`);
    if (courseMap.has(course.id)) errors.push(`${where}: Durchführungs-ID ${course.id} ist doppelt.`);
    courseMap.set(course.id, course);
    if (!offerMap.has(course.offerId)) offerMap.set(course.offerId, course.name);
    else if (offerMap.get(course.offerId) !== course.name) warnings.push(`${course.id}: Kursart-ID ${course.offerId} wird mit unterschiedlichen Namen verwendet.`);
    if (!Number.isFinite(course.gradeFrom) || !Number.isFinite(course.gradeTo)) {
      errors.push(`${course.id || where}: Klassenbereich ist ungültig.`);
    } else if (course.gradeFrom > course.gradeTo) {
      errors.push(`${course.id}: „Klasse von“ ist größer als „Klasse bis“.`);
    }
    if (course.max < 1) errors.push(`${course.id}: Maximalbelegung muss mindestens 1 sein.`);
    if (course.min > course.max) errors.push(`${course.id}: Mindestbelegung ist größer als Maximalbelegung.`);
    if (!MODES.has(course.mode)) errors.push(`${course.id}: Durchführung muss Pflicht oder Optional sein.`);
    if (course.cohortMin === 1) errors.push(`${course.id}: Kohortenminimum darf nicht 1 sein (0 = aus, leer = global, sonst mindestens 2).`);

    const gradeLimits = gradeLimitEntries(course);
    for (const limit of gradeLimits) {
      if (limit.min !== null && limit.max !== null && limit.min > limit.max) {
        warnings.push(`${course.id}: Jahrgang ${limit.grade}: Minimum ${limit.min} ist größer als Maximum ${limit.max}. Die widersprüchlichen Zielwerte werden bestmöglich angenähert.`);
      }
      if ((limit.min ?? 0) > course.max) {
        warnings.push(`${course.id}: Jahrgang ${limit.grade}: Minimum ${limit.min} ist größer als die gesamte Maximalbelegung ${course.max}. Diese Jahrgangsregel kann nur bestmöglich angenähert werden.`);
      }
      if (limit.grade < course.gradeFrom || limit.grade > course.gradeTo) {
        if ((limit.min ?? 0) > 0) warnings.push(`${course.id}: Jahrgang ${limit.grade} hat ein Minimum, liegt aber außerhalb des zugelassenen Klassenbereichs ${course.gradeFrom}–${course.gradeTo}. Diese Vorgabe wird bei Bedarf als Regelabweichung behandelt.`);
        else warnings.push(`${course.id}: Jahrgang ${limit.grade} liegt außerhalb des zugelassenen Klassenbereichs; die Jahrgangsgrenze hat daher keine Wirkung.`);
      }
    }
    const gradeMinTotal = gradeMinimumTotal(course);
    if (gradeMinTotal > course.max) {
      warnings.push(`${course.id}: Die Jahrgangs-Minima ergeben zusammen ${gradeMinTotal}, die Maximalbelegung des Kurses ist aber nur ${course.max}. Die Jahrgangsregeln werden bestmöglich angenähert.`);
    }
    if (course.gradeGroupRule.enabled) {
      if (course.gradeTo < 8) {
        warnings.push(`${course.id}: Die Jahrgangsgruppen-Regel hat keine Wirkung, weil der Kurs nur Jahrgänge unter 8 zulässt.`);
      }
      const overlapsSekI = course.gradeFrom <= 9 && course.gradeTo >= 8;
      const overlapsSekII = course.gradeTo >= 10;
      if (course.gradeGroupRule.balance && !(overlapsSekI && overlapsSekII)) {
        warnings.push(`${course.id}: Der weiche Ausgleich der Jahrgangsgruppen wirkt nur sinnvoll, wenn Jahrgänge 8–9 und 10 aufwärts zugelassen sind.`);
      }
      if (course.mode === "Pflicht" && course.gradeFrom >= 8) {
        const minimum = effectiveMinimum(course);
        const firstAllowedTotal = Math.ceil(minimum / GRADE_GROUP_SIZE) * GRADE_GROUP_SIZE;
        if (firstAllowedTotal > course.max) {
          warnings.push(`${course.id}: Zwischen Mindestbelegung ${minimum} und Maximum ${course.max} liegt keine durch ${GRADE_GROUP_SIZE} teilbare Gesamtbelegung. Die Jahrgangsgruppen-Regel wird deshalb bestmöglich angenähert.`);
        }
      }
    }
  });

  event.participants.forEach((person, index) => {
    const where = `Teilnehmer-Zeile ${index + 1}`;
    if (!person.id) errors.push(`${where}: Person-ID fehlt.`);
    if (personMap.has(person.id)) errors.push(`${where}: Person-ID ${person.id} ist doppelt.`);
    personMap.set(person.id, person);
    if (!person.firstName || !person.lastName) warnings.push(`${person.id || where}: Vor- oder Nachname fehlt.`);
    if (!Number.isFinite(parseGrade(person.className))) errors.push(`${person.id || where}: Klasse ist ungültig.`);
    person.wishes.filter(Boolean).forEach((wish) => {
      if (!offerMap.has(wish)) warnings.push(`${person.id}: Wunsch ${wish} ist nicht als Kursart vorhanden.`);
    });
    const used = person.wishes.filter(Boolean);
    if (new Set(used).size !== used.length) warnings.push(`${person.id}: Ein Wunsch wurde mehrfach eingetragen.`);
    if (person.fixed && !courseMap.has(person.fixed)) errors.push(`${person.id}: Feste Setzung auf Durchführung ${person.fixed} ist unbekannt.`);
  });

  event.locks.forEach((lock, index) => {
    if (!lock.personId && !lock.workshopId) return;
    if (!personMap.has(lock.personId)) warnings.push(`Sperrung ${index + 1}: Person ${lock.personId} ist unbekannt.`);
    if (!courseMap.has(lock.workshopId)) warnings.push(`Sperrung ${index + 1}: Workshop ${lock.workshopId} ist unbekannt.`);
    const key = `${lock.personId}\u0000${lock.workshopId}`;
    if (lockSet.has(key)) warnings.push(`Sperrung ${index + 1}: Kombination ist doppelt.`);
    lockSet.add(key);
  });

  for (const person of event.participants) {
    if (!person.fixed || !courseMap.has(person.fixed)) continue;
    const course = courseMap.get(person.fixed);
    const grade = parseGrade(person.className);
    if (grade < course.gradeFrom || grade > course.gradeTo) {
      errors.push(`${person.id}: Feste Setzung ${course.id} passt nicht zur Klassenstufe.`);
    }
    if (course.schoolForm !== "Alle" && course.schoolForm !== person.schoolForm) {
      errors.push(`${person.id}: Feste Setzung ${course.id} passt nicht zum Bildungsgang.`);
    }
    if (lockSet.has(`${person.id}\u0000${course.id}`)) {
      errors.push(`${person.id}: Feste Setzung ${course.id} ist gleichzeitig gesperrt.`);
    }
  }

  const mandatoryMinimum = event.workshops
    .filter((course) => course.mode === "Pflicht")
    .reduce((sum, course) => sum + effectiveMinimum(course), 0);
  if (mandatoryMinimum > event.participants.length) {
    errors.push(`Die wirksamen Mindestbelegungen der Pflichtkurse (${mandatoryMinimum}) übersteigen die Teilnehmerzahl (${event.participants.length}).`);
  }

  return { event, errors, warnings };
}

class BinaryHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= item[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const root = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (true) {
        let left = i * 2 + 1;
        if (left >= a.length) break;
        let right = left + 1;
        let child = right < a.length && a[right][0] < a[left][0] ? right : left;
        if (a[child][0] >= last[0]) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return root;
  }
  get size() { return this.items.length; }
}

class MinCostMaxFlow {
  constructor(n) {
    this.graph = Array.from({ length: n }, () => []);
  }
  addEdge(from, to, cap, cost, meta = null) {
    const forward = { to, rev: this.graph[to].length, cap, cost, initialCap: cap, meta };
    const reverse = { to: from, rev: this.graph[from].length, cap: 0, cost: -cost, initialCap: 0, meta: null };
    this.graph[from].push(forward);
    this.graph[to].push(reverse);
    return forward;
  }
  run(source, sink, maxFlow) {
    const n = this.graph.length;
    const potential = Array(n).fill(0);
    let flow = 0;
    let cost = 0;

    while (flow < maxFlow) {
      const dist = Array(n).fill(Infinity);
      const prevNode = Array(n).fill(-1);
      const prevEdge = Array(n).fill(-1);
      dist[source] = 0;
      const heap = new BinaryHeap();
      heap.push([0, source]);

      while (heap.size) {
        const [d, node] = heap.pop();
        if (d !== dist[node]) continue;
        const edges = this.graph[node];
        for (let i = 0; i < edges.length; i += 1) {
          const edge = edges[i];
          if (edge.cap <= 0) continue;
          const next = d + edge.cost + potential[node] - potential[edge.to];
          if (next < dist[edge.to]) {
            dist[edge.to] = next;
            prevNode[edge.to] = node;
            prevEdge[edge.to] = i;
            heap.push([next, edge.to]);
          }
        }
      }

      if (!Number.isFinite(dist[sink])) break;
      for (let i = 0; i < n; i += 1) {
        if (Number.isFinite(dist[i])) potential[i] += dist[i];
      }

      let add = maxFlow - flow;
      for (let node = sink; node !== source; node = prevNode[node]) {
        if (node < 0 || prevNode[node] < 0) { add = 0; break; }
        add = Math.min(add, this.graph[prevNode[node]][prevEdge[node]].cap);
      }
      if (add <= 0) break;

      for (let node = sink; node !== source; node = prevNode[node]) {
        const edge = this.graph[prevNode[node]][prevEdge[node]];
        edge.cap -= add;
        this.graph[node][edge.rev].cap += add;
        cost += add * edge.cost;
      }
      flow += add;
    }

    return { flow, cost };
  }
}

class Dinic {
  constructor(n) { this.g = Array.from({ length: n }, () => []); }
  addEdge(from, to, cap) {
    const f = { to, rev: this.g[to].length, cap };
    const r = { to: from, rev: this.g[from].length, cap: 0 };
    this.g[from].push(f); this.g[to].push(r);
  }
  maxFlow(source, sink) {
    let total = 0;
    const n = this.g.length;
    while (true) {
      const level = Array(n).fill(-1);
      level[source] = 0;
      const queue = [source];
      for (let q = 0; q < queue.length; q += 1) {
        const v = queue[q];
        for (const e of this.g[v]) if (e.cap > 0 && level[e.to] < 0) {
          level[e.to] = level[v] + 1; queue.push(e.to);
        }
      }
      if (level[sink] < 0) return total;
      const it = Array(n).fill(0);
      const dfs = (v, pushed) => {
        if (v === sink) return pushed;
        for (; it[v] < this.g[v].length; it[v] += 1) {
          const e = this.g[v][it[v]];
          if (e.cap <= 0 || level[e.to] !== level[v] + 1) continue;
          const sent = dfs(e.to, Math.min(pushed, e.cap));
          if (sent > 0) { e.cap -= sent; this.g[e.to][e.rev].cap += sent; return sent; }
        }
        return 0;
      };
      while (true) {
        const sent = dfs(source, Number.MAX_SAFE_INTEGER);
        if (!sent) break;
        total += sent;
      }
    }
  }
}

function fixedLoads(event, courseMap) {
  const loads = new Map([...courseMap.keys()].map((id) => [id, 0]));
  for (const person of event.participants) if (person.fixed && loads.has(person.fixed)) {
    loads.set(person.fixed, loads.get(person.fixed) + 1);
  }
  return loads;
}

function canMeetMinimums(event, openSet, lockSet, courseMap) {
  const fixed = fixedLoads(event, courseMap);
  for (const [courseId, load] of fixed) {
    if (load > 0 && !openSet.has(courseId)) return false;
    if (load > (courseMap.get(courseId)?.max ?? 0)) return false;
  }

  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const nonFixed = event.participants.filter((p) => !p.fixed);
  const source = 0;
  const courseStart = 1;
  const personStart = courseStart + courses.length;
  const sink = personStart + nonFixed.length;
  const dinic = new Dinic(sink + 1);
  let requiredTotal = 0;

  courses.forEach((course, ci) => {
    const requirement = Math.max(0, effectiveMinimum(course) - (fixed.get(course.id) || 0));
    if (requirement > course.max - (fixed.get(course.id) || 0)) return false;
    requiredTotal += requirement;
    dinic.addEdge(source, courseStart + ci, requirement);
    nonFixed.forEach((person, pi) => {
      if (courseEligible(person, course, lockSet, event.settings.allowOutside)) {
        dinic.addEdge(courseStart + ci, personStart + pi, 1);
      }
    });
  });
  nonFixed.forEach((_, pi) => dinic.addEdge(personStart + pi, sink, 1));
  return dinic.maxFlow(source, sink) === requiredTotal;
}

function determineOpenCourses(event, lockSet, courseMap) {
  const open = new Set(event.workshops.filter((c) => c.mode === "Pflicht").map((c) => c.id));
  for (const person of event.participants) if (person.fixed) open.add(person.fixed);

  if (!canMeetMinimums(event, open, lockSet, courseMap)) {
    throw new Error("Die Mindestbelegungen der Pflichtkurse können nicht gleichzeitig erfüllt werden. Prüfe Wünsche, Sperrungen, Klassenstufen und Bildungsgänge.");
  }

  const optional = event.workshops
    .filter((course) => course.mode === "Optional" && !open.has(course.id))
    .map((course) => {
      let score = 0;
      let candidates = 0;
      for (const person of event.participants) {
        if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) continue;
        candidates += 1;
        const idx = rankIndex(person, course);
        score += [100, 30, 10, 3][idx] ?? (event.settings.allowOutside ? 1 : 0);
      }
      return { course, score, candidates };
    })
    .filter(({ course, candidates }) => candidates >= effectiveMinimum(course))
    .sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id, "de"));

  for (const { course } of optional) {
    const trial = new Set(open);
    trial.add(course.id);
    if (canMeetMinimums(event, trial, lockSet, courseMap)) open.add(course.id);
  }
  return open;
}

function calculateTargets(event, openSet, courseMap, fixed) {
  const targets = new Map();
  const openCourses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  let baseTotal = 0;
  let maxTotal = 0;

  for (const course of openCourses) {
    const base = Math.max(effectiveMinimum(course), fixed.get(course.id) || 0);
    const target = Math.min(base, course.max);
    targets.set(course.id, target);
    baseTotal += target;
    maxTotal += course.max;
  }

  if (baseTotal > event.participants.length) throw new Error("Die Mindestbelegungen übersteigen die Teilnehmerzahl.");
  let remaining = Math.min(event.participants.length, maxTotal) - baseTotal;
  const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);

  // Kleine Kurse (bis einschließlich der eingestellten Schwelle) erhalten
  // bevorzugt ihre Maximalgröße als Ziel. Die Mindestbelegungen aller anderen
  // Kurse sind zu diesem Zeitpunkt bereits reserviert.
  const smallCourses = openCourses
    .filter((course) => threshold > 0 && course.max <= threshold)
    .sort((a, b) => a.max - b.max || a.id.localeCompare(b.id, "de"));

  for (const course of smallCourses) {
    if (remaining <= 0) break;
    const gap = Math.max(0, course.max - (targets.get(course.id) || 0));
    const add = Math.min(gap, remaining);
    targets.set(course.id, (targets.get(course.id) || 0) + add);
    remaining -= add;
  }

  // Der Rest wird auf die größeren Kurse nach absoluter Teilnehmerzahl
  // möglichst gleichmäßig verteilt. Maximalgrößen bleiben harte Grenzen.
  const largeCourses = openCourses.filter((course) => !(threshold > 0 && course.max <= threshold));
  while (remaining > 0 && largeCourses.length) {
    const candidates = largeCourses
      .filter((course) => (targets.get(course.id) || 0) < course.max)
      .sort((a, b) => (targets.get(a.id) || 0) - (targets.get(b.id) || 0) || a.max - b.max || a.id.localeCompare(b.id, "de"));
    if (!candidates.length) break;
    const course = candidates[0];
    targets.set(course.id, (targets.get(course.id) || 0) + 1);
    remaining -= 1;
  }

  // Falls es ausschließlich kleine Kurse gibt oder große Kurse bereits voll sind.
  while (remaining > 0) {
    const candidates = openCourses
      .filter((course) => (targets.get(course.id) || 0) < course.max)
      .sort((a, b) => (targets.get(a.id) || 0) - (targets.get(b.id) || 0) || a.max - b.max || a.id.localeCompare(b.id, "de"));
    if (!candidates.length) break;
    const course = candidates[0];
    targets.set(course.id, (targets.get(course.id) || 0) + 1);
    remaining -= 1;
  }

  return targets;
}

function assignMinimums(event, openSet, lockSet, courseMap, assignments, loads) {
  const nonFixed = event.participants.filter((person) => !assignments.has(person.id));
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const existingRanks = rankCountsFromAssignments(event, assignments, courseMap);
  const source = 0;
  const courseStart = 1;
  const rankStart = courseStart + courses.length;
  const rankNode = (ci, rank) => rankStart + ci * 5 + rank;
  const personStart = rankStart + courses.length * 5;
  const sink = personStart + nonFixed.length;
  const flow = new MinCostMaxFlow(sink + 1);
  const assignmentEdges = [];
  let requiredTotal = 0;

  courses.forEach((course, ci) => {
    const required = Math.max(0, effectiveMinimum(course) - (loads.get(course.id) || 0));
    requiredTotal += required;
    flow.addEdge(source, courseStart + ci, required, 0);

    for (let rank = 0; rank < 5; rank += 1) {
      const already = existingRanks.get(course.id)?.[rank] || 0;
      for (let seat = 1; seat <= required; seat += 1) {
        flow.addEdge(
          courseStart + ci,
          rankNode(ci, rank),
          1,
          badWishMarginalPenalty(rank, already + seat),
        );
      }
    }

    nonFixed.forEach((person, pi) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      const rank = rankBucket(person, course);
      const edge = flow.addEdge(rankNode(ci, rank), personStart + pi, 1, preferenceCost(person, course), {
        personId: person.id,
        courseId: course.id,
      });
      assignmentEdges.push(edge);
    });
  });
  nonFixed.forEach((_, pi) => flow.addEdge(personStart + pi, sink, 1, 0));

  const outcome = flow.run(source, sink, requiredTotal);
  if (outcome.flow !== requiredTotal) throw new Error("Die Mindestbelegungen konnten nicht erfüllt werden.");
  for (const edge of assignmentEdges) {
    if (edge.initialCap === 1 && edge.cap === 0) {
      assignments.set(edge.meta.personId, edge.meta.courseId);
      loads.set(edge.meta.courseId, (loads.get(edge.meta.courseId) || 0) + 1);
    }
  }
}

function assignRemaining(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const remainingPeople = event.participants.filter((person) => !assignments.has(person.id));
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const existingRanks = rankCountsFromAssignments(event, assignments, courseMap);
  const source = 0;
  const personStart = 1;
  const rankStart = personStart + remainingPeople.length;
  const rankNode = (ci, rank) => rankStart + ci * 5 + rank;
  const courseStart = rankStart + courses.length * 5;
  const sink = courseStart + courses.length;
  const flow = new MinCostMaxFlow(sink + 1);
  const assignmentEdges = [];
  const unassignedEdges = [];

  remainingPeople.forEach((person, pi) => {
    const personNode = personStart + pi;
    flow.addEdge(source, personNode, 1, 0);
    courses.forEach((course, ci) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      if ((loads.get(course.id) || 0) >= course.max) return;
      const rank = rankBucket(person, course);
      const edge = flow.addEdge(personNode, rankNode(ci, rank), 1, preferenceCost(person, course), {
        personId: person.id,
        courseId: course.id,
      });
      assignmentEdges.push(edge);
    });
    const edge = flow.addEdge(personNode, sink, 1, PREFERENCE_COST.unassigned, { personId: person.id });
    unassignedEdges.push(edge);
  });

  courses.forEach((course, ci) => {
    const current = loads.get(course.id) || 0;
    const available = Math.max(0, course.max - current);

    for (let rank = 0; rank < 5; rank += 1) {
      const already = existingRanks.get(course.id)?.[rank] || 0;
      for (let seat = 1; seat <= available; seat += 1) {
        flow.addEdge(
          rankNode(ci, rank),
          courseStart + ci,
          1,
          badWishMarginalPenalty(rank, already + seat),
        );
      }
    }

    for (let seat = 1; seat <= available; seat += 1) {
      const resultingLoad = current + seat;
      const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);
      const smallCourse = threshold > 0 && course.max <= threshold;
      const balanceActive = event.settings.balanceWeight > 0;
      let penalty = 0;
      if (balanceActive) {
        if (smallCourse) {
          // Kleine Kurse sollen bevorzugt ihr Maximum erreichen. Eine leichte
          // Zusatzstrafe auf große Kurse macht bei ansonsten gleicher
          // Wunschqualität den kleinen Kurs attraktiver.
          penalty = Math.round(event.settings.balanceWeight * Math.max(0, resultingLoad - course.max));
        } else {
          penalty = Math.round(event.settings.balanceWeight * Math.abs(resultingLoad - (targets.get(course.id) || 0)));
        }
      }
      flow.addEdge(courseStart + ci, sink, 1, penalty);
    }
  });

  const outcome = flow.run(source, sink, remainingPeople.length);
  if (outcome.flow !== remainingPeople.length) throw new Error("Die restlichen Teilnehmer konnten nicht verarbeitet werden.");
  for (const edge of assignmentEdges) {
    if (edge.initialCap === 1 && edge.cap === 0) {
      assignments.set(edge.meta.personId, edge.meta.courseId);
      loads.set(edge.meta.courseId, (loads.get(edge.meta.courseId) || 0) + 1);
    }
  }
  for (const edge of unassignedEdges) {
    if (edge.initialCap === 1 && edge.cap === 0 && !assignments.has(edge.meta.personId)) {
      assignments.set(edge.meta.personId, "");
    }
  }
}


// Vollständige globale Neuberechnung mit unteren und oberen Schranken.
// Anders als die lokalen Reparaturschritte kann dieses Flussmodell auch
// Verschiebungsketten über beliebig viele Kurse gleichzeitig finden.
function rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed = false } = {}) {
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const courseIndex = new Map(courses.map((course, index) => [course.id, index]));
  const grades = [...new Set([
    ...event.participants.map((person) => parseGrade(person.className)).filter(Number.isFinite),
    ...courses.flatMap((course) => gradeLimitEntries(course).map((limit) => limit.grade)),
  ])].sort((a, b) => a - b);
  const gradeSlots = [];
  const gradeSlotIndex = new Map();

  for (const course of courses) {
    for (const grade of grades) {
      if (grade < course.gradeFrom || grade > course.gradeTo) continue;
      const index = gradeSlots.length;
      gradeSlots.push({ course, grade });
      gradeSlotIndex.set(`${course.id}\u0000${grade}`, index);
    }
  }

  const source = 0;
  const personStart = 1;
  const gradeStart = personStart + event.participants.length;
  const courseStart = gradeStart + gradeSlots.length;
  const unassignedNode = courseStart + courses.length;
  const sink = unassignedNode + 1;
  const superSource = sink + 1;
  const superSink = superSource + 1;
  const flow = new MinCostMaxFlow(superSink + 1);
  const balance = Array(superSink + 1).fill(0);
  const assignmentEdges = [];
  const initialUnassigned = event.participants.reduce((sum, person) => sum + (assignments.get(person.id) ? 0 : 1), 0);
  let invalidBounds = false;
  const softGradeBaseline = 10_000_000_000;
  const softGradeViolation = 1_000_000_000_000;
  const softPreference = (person, course) => {
    if (person.fixed === course.id) return 0;
    return [0, 1_000, 1_000_000, 1_000_000_000, 2_000_000_000][rankBucket(person, course)] ?? 2_000_000_000;
  };

  const addBoundedEdge = (from, to, lower, upper, cost, meta = null) => {
    const lo = Math.max(0, Math.trunc(lower));
    const hi = Math.max(0, Math.trunc(upper));
    if (lo > hi) { invalidBounds = true; return null; }
    balance[from] -= lo;
    balance[to] += lo;
    return flow.addEdge(from, to, hi - lo, cost, meta);
  };

  event.participants.forEach((person, personIndex) => {
    const personNode = personStart + personIndex;
    addBoundedEdge(source, personNode, 1, 1, 0);
    const grade = parseGrade(person.className);

    for (const course of courses) {
      const slotIndex = gradeSlotIndex.get(`${course.id}\u0000${grade}`);
      if (slotIndex === undefined || !courseEligible(person, course, lockSet, event.settings.allowOutside)) continue;
      const stabilityCost = (assignments.get(person.id) || "") === course.id ? 0 : 1;
      const edge = addBoundedEdge(
        personNode,
        gradeStart + slotIndex,
        0,
        1,
        (relaxed ? softPreference(person, course) : preferenceCost(person, course)) + stabilityCost,
        { personId: person.id, courseId: course.id },
      );
      if (edge) assignmentEdges.push(edge);
    }

    if (!person.fixed) {
      const stabilityCost = assignments.get(person.id) ? 1 : 0;
      addBoundedEdge(
        personNode,
        unassignedNode,
        0,
        1,
        (relaxed ? softGradeViolation * 5 : PREFERENCE_COST.unassigned) + stabilityCost,
      );
    }
  });

  gradeSlots.forEach(({ course, grade }, slotIndex) => {
    const configured = course.gradeLimits?.[String(grade)] || {};
    const minimum = nullableCount(configured.min) ?? 0;
    const maximum = courseGradeMaximum(course, grade);
    const from = gradeStart + slotIndex;
    const to = courseStart + courseIndex.get(course.id);
    if (!relaxed) {
      addBoundedEdge(from, to, minimum, maximum, 0);
      return;
    }

    const preferredSeats = Math.min(minimum, course.max);
    const regularSeats = Math.max(0, Math.min(maximum, course.max) - preferredSeats);
    const excessSeats = Math.max(0, course.max - Math.max(maximum, preferredSeats));
    if (preferredSeats) addBoundedEdge(from, to, 0, preferredSeats, 0);
    if (regularSeats) addBoundedEdge(from, to, 0, regularSeats, softGradeBaseline);
    if (excessSeats) addBoundedEdge(from, to, 0, excessSeats, softGradeBaseline + softGradeViolation);
  });

  courses.forEach((course, index) => {
    const minimum = relaxed
      ? Math.max(course.min, course.mode === "Pflicht" ? 1 : 0)
      : effectiveMinimum(course);
    addBoundedEdge(courseStart + index, sink, minimum, course.max, 0);
  });
  // Eine Jahrgangsregel darf die Zahl der Nichtzugeteilten niemals erhöhen.
  // Innerhalb dieser Obergrenze darf die globale Suche Personen austauschen und
  // bereits unzugeteilte Schüler nach Möglichkeit sogar noch unterbringen.
  addBoundedEdge(unassignedNode, sink, 0, initialUnassigned, 0);
  addBoundedEdge(sink, source, event.participants.length, event.participants.length, 0);
  if (invalidBounds) return false;

  let required = 0;
  for (let node = 0; node <= sink; node += 1) {
    if (balance[node] > 0) {
      flow.addEdge(superSource, node, balance[node], 0);
      required += balance[node];
    } else if (balance[node] < 0) {
      flow.addEdge(node, superSink, -balance[node], 0);
    }
  }

  const outcome = flow.run(superSource, superSink, required);
  if (outcome.flow !== required) return false;

  const rebuilt = new Map(event.participants.map((person) => [person.id, ""]));
  for (const edge of assignmentEdges) {
    if (edge.initialCap - edge.cap > 0) rebuilt.set(edge.meta.personId, edge.meta.courseId);
  }
  for (const person of event.participants) {
    if (person.fixed && rebuilt.get(person.id) !== person.fixed) return false;
  }

  assignments.clear();
  for (const [personId, courseId] of rebuilt) assignments.set(personId, courseId);
  for (const courseId of loads.keys()) loads.set(courseId, 0);
  for (const courseId of assignments.values()) {
    if (courseId && loads.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
  }
  return relaxed || courseGradeLimitViolations(event, openSet, courseMap, assignments).length === 0;
}


function buildCohortCounts(event, assignments, courseMap) {
  const counts = new Map();
  const personMap = new Map(event.participants.map((p) => [p.id, p]));
  for (const [personId, courseId] of assignments) {
    if (!courseId || !courseMap.has(courseId)) continue;
    const person = personMap.get(personId);
    if (!person) continue;
    const key = `${courseId}\u0001${cohortKey(person)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function cohortCount(counts, courseId, personOrKey) {
  const key = typeof personOrKey === "string" && personOrKey.includes("\u0000") ? personOrKey : cohortKey(personOrKey);
  return counts.get(`${courseId}\u0001${key}`) || 0;
}

function donorMoveSafe(event, person, donor, counts, loads) {
  if (!donor) return true;
  if ((loads.get(donor.id) || 0) - 1 < effectiveMinimum(donor)) return false;
  const min = effectiveCohortMinimum(event, donor);
  if (!min) return true;
  const before = cohortCount(counts, donor.id, person);
  const after = before - 1;
  return after === 0 || after >= min;
}

function destinationAcceptsWithoutViolation(event, person, target, counts) {
  const min = effectiveCohortMinimum(event, target);
  if (!min) return true;
  const before = cohortCount(counts, target.id, person);
  return before >= min;
}

function applyMove(person, fromId, toId, assignments, loads, counts) {
  const ckey = cohortKey(person);
  if (fromId) {
    loads.set(fromId, (loads.get(fromId) || 0) - 1);
    const k = `${fromId}\u0001${ckey}`;
    counts.set(k, (counts.get(k) || 0) - 1);
  }
  assignments.set(person.id, toId);
  if (toId) {
    loads.set(toId, (loads.get(toId) || 0) + 1);
    const k = `${toId}\u0001${ckey}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
}

function findCohortViolations(event, openSet, courseMap, assignments) {
  const personMap = new Map(event.participants.map((p) => [p.id, p]));
  const counts = buildCohortCounts(event, assignments, courseMap);
  const violations = [];
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    const min = effectiveCohortMinimum(event, course);
    if (!min) continue;
    for (const [key, count] of counts) {
      const prefix = `${courseId}\u0001`;
      if (!key.startsWith(prefix) || count <= 0 || count >= min) continue;
      const ckey = key.slice(prefix.length);
      const members = [];
      for (const [personId, assignedCourse] of assignments) {
        const person = personMap.get(personId);
        if (assignedCourse === courseId && person && cohortKey(person) === ckey) members.push(person);
      }
      violations.push({ course, cohortKey: ckey, count, min, members });
    }
  }
  return { violations, counts };
}

function repairCohortMinimums(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const personMap = new Map(event.participants.map((p) => [p.id, p]));
  const maxPasses = Math.max(20, event.workshops.length * 4);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { violations, counts } = findCohortViolations(event, openSet, courseMap, assignments);
    if (!violations.length) return [];

    violations.sort((a, b) => (a.min - a.count) - (b.min - b.count) || a.course.id.localeCompare(b.course.id, "de"));
    let repairedSomething = false;

    for (const violation of violations) {
      const target = violation.course;
      const need = violation.min - violation.count;
      const capacity = target.max - (loads.get(target.id) || 0);

      // Prefer reinforcing the existing cohort. Moving between two executions of the same
      // course type has zero wish penalty because both satisfy the same selected course type.
      if (capacity >= need) {
        const candidates = event.participants
          .filter((person) => {
            if (person.fixed || cohortKey(person) !== violation.cohortKey) return false;
            const fromId = assignments.get(person.id) || "";
            if (!fromId || fromId === target.id) return false;
            if (!courseEligible(person, target, lockSet, event.settings.allowOutside)) return false;
            const donor = courseMap.get(fromId);
            return donorMoveSafe(event, person, donor, counts, loads);
          })
          .map((person) => {
            const fromId = assignments.get(person.id) || "";
            const donor = courseMap.get(fromId);
            const delta = preferenceCost(person, target) - (donor ? preferenceCost(person, donor) : 1_000_000_000);
            const balance = Math.abs((loads.get(target.id) || 0) + 1 - (targets.get(target.id) || 0));
            return { person, fromId, delta: delta + balance };
          })
          .sort((a, b) => a.delta - b.delta || a.person.id.localeCompare(b.person.id, "de"));

        if (candidates.length >= need) {
          for (const candidate of candidates.slice(0, need)) {
            applyMove(candidate.person, candidate.fromId, target.id, assignments, loads, counts);
          }
          repairedSomething = true;
          break;
        }
      }

      // Otherwise remove the small cohort from this execution entirely. This is only
      // possible for non-fixed members and if the course minimum survives the removal.
      if (violation.members.every((p) => !p.fixed) && (loads.get(target.id) || 0) - violation.count >= effectiveMinimum(target)) {
        const planned = [];
        const tempLoads = new Map(loads);
        const tempCounts = new Map(counts);
        let feasible = true;

        for (const person of violation.members) {
          const destinations = [...openSet]
            .map((id) => courseMap.get(id))
            .filter((course) => course && course.id !== target.id)
            .filter((course) => (tempLoads.get(course.id) || 0) < course.max)
            .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
            .filter((course) => destinationAcceptsWithoutViolation(event, person, course, tempCounts))
            .map((course) => ({
              course,
              cost: preferenceCost(person, course) + Math.round(event.settings.balanceWeight * Math.abs((tempLoads.get(course.id) || 0) + 1 - (targets.get(course.id) || 0))),
            }))
            .sort((a, b) => a.cost - b.cost || a.course.id.localeCompare(b.course.id, "de"));

          if (!destinations.length) { feasible = false; break; }
          const dest = destinations[0].course;
          planned.push({ person, toId: dest.id });
          tempLoads.set(dest.id, (tempLoads.get(dest.id) || 0) + 1);
          tempCounts.set(`${dest.id}\u0001${cohortKey(person)}`, cohortCount(tempCounts, dest.id, person) + 1);
        }

        if (feasible) {
          for (const move of planned) applyMove(move.person, target.id, move.toId, assignments, loads, counts);
          repairedSomething = true;
          break;
        }
      }
    }

    if (!repairedSomething) {
      // Eine Kohortenregel darf keine ansonsten mögliche Zuteilung verhindern.
      // Die verbleibende Abweichung wird später kurs- und personenbezogen erklärt.
      return violations;
    }
  }

  const remaining = findCohortViolations(event, openSet, courseMap, assignments).violations;
  return remaining;
}

function cohortSummaryForCourse(event, course, assignments, personMap) {
  const counts = new Map();
  for (const [personId, courseId] of assignments) {
    if (courseId !== course.id) continue;
    const person = personMap.get(personId);
    if (!person) continue;
    const key = cohortKey(person);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "de", { numeric: true }))
    .map(([key, count]) => ({ key, label: cohortLabelFromKey(key), count }));
}


function gradeCountsForPeople(people) {
  const counts = new Map();
  for (const person of people || []) {
    const grade = parseGrade(person.className);
    if (!Number.isFinite(grade)) continue;
    counts.set(grade, (counts.get(grade) || 0) + 1);
  }
  return counts;
}

function gradeLimitViolationsForPeople(course, people) {
  const counts = gradeCountsForPeople(people);
  const violations = [];
  for (const limit of gradeLimitEntries(course)) {
    const count = counts.get(limit.grade) || 0;
    if (limit.min !== null && count < limit.min) {
      violations.push({
        kind: "gradeMin", course, grade: limit.grade, count, min: limit.min, max: limit.max,
        members: (people || []).filter((person) => parseGrade(person.className) === limit.grade),
        label: `Jahrgang ${limit.grade}`,
      });
    }
    if (limit.max !== null && count > limit.max) {
      violations.push({
        kind: "gradeMax", course, grade: limit.grade, count, min: limit.min, max: limit.max,
        members: (people || []).filter((person) => parseGrade(person.className) === limit.grade),
        label: `Jahrgang ${limit.grade}`,
      });
    }
  }
  return violations;
}

function cohortViolationsForPeople(event, course, people) {
  const min = effectiveCohortMinimum(event, course);
  if (!min) return [];
  const groups = new Map();
  for (const person of people || []) {
    const key = cohortKey(person);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const violations = [];
  for (const [key, members] of groups) {
    if (members.length > 0 && members.length < min) {
      violations.push({ kind: "cohort", course, key, count: members.length, min, members, label: cohortLabelFromKey(key) });
    }
  }
  return violations;
}

function courseGradeLimitViolations(event, openSet, courseMap, assignments) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    violations.push(...gradeLimitViolationsForPeople(course, byCourse.get(courseId) || []));
  }
  return violations;
}

function repairCourseGradeLimits(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const maxPasses = Math.max(80, event.workshops.length * 20);
  let globalSearchTried = false;

  if (event.settings.gradeLimitsRelaxed) {
    if (!rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed: true })) {
      throw new Error("Auch die bestmögliche Jahrgangsverteilung konnte mit den aktuellen Mindestbelegungen, Kapazitäten, Sperrungen und festen Setzungen nicht berechnet werden.");
    }
    return courseGradeLimitViolations(event, openSet, courseMap, assignments);
  }

  const bestSwapForViolation = (violation, byCourse) => {
    const target = violation.course;
    const targetPeople = byCourse.get(target.id) || [];
    const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
    const insiders = (violation.kind === "gradeMax"
      ? violation.members
      : targetPeople.filter((person) => parseGrade(person.className) !== violation.grade))
      .filter((person) => !person.fixed);
    const outsiders = event.participants
      .filter((person) => !person.fixed && (assignments.get(person.id) || "") !== target.id)
      .filter((person) => violation.kind === "gradeMin"
        ? parseGrade(person.className) === violation.grade
        : parseGrade(person.className) !== violation.grade)
      .filter((person) => courseEligible(person, target, lockSet, event.settings.allowOutside));
    const candidates = [];

    for (const inside of insiders) {
      const targetWithoutInside = targetPeople.filter((person) => person.id !== inside.id);
      for (const outside of outsiders) {
        const fromId = assignments.get(outside.id) || "";
        const donor = fromId ? courseMap.get(fromId) : null;
        if (fromId && (!donor || !openSet.has(fromId) || !courseEligible(inside, donor, lockSet, event.settings.allowOutside))) continue;

        const targetAfter = [...targetWithoutInside, outside];
        const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
        if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) continue;

        if (donor) {
          const donorBefore = byCourse.get(fromId) || [];
          const donorAfter = [...donorBefore.filter((person) => person.id !== outside.id), inside];
          const donorBeforeState = hardRuleStateForCourse(event, donor, donorBefore);
          const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
          if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) continue;
        }

        const score = assignmentPreferenceCost(inside, fromId, courseMap)
          + assignmentPreferenceCost(outside, target.id, courseMap)
          - assignmentPreferenceCost(inside, target.id, courseMap)
          - assignmentPreferenceCost(outside, fromId, courseMap);
        candidates.push({ inside, outside, fromId, score });
      }
    }

    return candidates
      .sort((a, b) => a.score - b.score
        || a.inside.id.localeCompare(b.inside.id, "de")
        || a.outside.id.localeCompare(b.outside.id, "de"))[0] || null;
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const byCourse = peopleByCourse(event, assignments);
    const violations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
    if (!violations.length) return;

    violations.sort((a, b) => {
      const aSeverity = a.kind === "gradeMax" ? a.count - a.max : a.min - a.count;
      const bSeverity = b.kind === "gradeMax" ? b.count - b.max : b.min - b.count;
      return bSeverity - aSeverity || a.course.id.localeCompare(b.course.id, "de") || a.grade - b.grade;
    });

    let changed = false;

    for (const violation of violations) {
      const target = violation.course;
      const targetPeople = byCourse.get(target.id) || [];

      if (violation.kind === "gradeMin") {
        const candidates = event.participants
          .filter((person) => !person.fixed && parseGrade(person.className) === violation.grade)
          .filter((person) => {
            const fromId = assignments.get(person.id) || "";
            if (fromId === target.id) return false;
            return courseEligible(person, target, lockSet, event.settings.allowOutside);
          })
          .map((person) => {
            const fromId = assignments.get(person.id) || "";
            const donor = fromId ? courseMap.get(fromId) : null;
            const donorPeople = donor ? (byCourse.get(fromId) || []) : [];
            const donorAfter = donor ? donorPeople.filter((item) => item.id !== person.id) : [];
            if (donor && donorAfter.length < effectiveMinimum(donor)) return null;
            if (donor) {
              const donorBeforeState = hardRuleStateForCourse(event, donor, donorPeople);
              const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
              if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) return null;
            }

            const targetAfter = [...targetPeople, person];
            if (targetAfter.length > target.max) return null;
            if (gradeCountsForPeople(targetAfter).get(violation.grade) > courseGradeMaximum(target, violation.grade)) return null;
            const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) return null;

            const currentCost = donor ? preferenceCost(person, donor) : PREFERENCE_COST.unassigned;
            const balance = Math.round(event.settings.balanceWeight * Math.abs((loads.get(target.id) || 0) + 1 - (targets.get(target.id) || 0)));
            return { person, fromId, score: preferenceCost(person, target) - currentCost + balance };
          })
          .filter(Boolean)
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const chosen = candidates[0];
        if (chosen) {
          if (chosen.fromId) loads.set(chosen.fromId, (loads.get(chosen.fromId) || 0) - 1);
          assignments.set(chosen.person.id, target.id);
          loads.set(target.id, (loads.get(target.id) || 0) + 1);
          changed = true;
          break;
        }

        const swap = bestSwapForViolation(violation, byCourse);
        if (!swap) continue;
        assignments.set(swap.inside.id, swap.fromId);
        assignments.set(swap.outside.id, target.id);
        changed = true;
        break;
      }

      if (violation.kind === "gradeMax") {
        const movable = violation.members
          .filter((person) => !person.fixed)
          .map((person) => {
            const targetAfter = targetPeople.filter((item) => item.id !== person.id);
            if (targetAfter.length < effectiveMinimum(target)) return null;
            const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) return null;

            const destinations = [...openSet]
              .map((id) => courseMap.get(id))
              .filter((course) => course && course.id !== target.id)
              .filter((course) => (loads.get(course.id) || 0) < course.max)
              .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
              .map((course) => {
                const existing = byCourse.get(course.id) || [];
                const after = [...existing, person];
                const grade = parseGrade(person.className);
                if ((gradeCountsForPeople(after).get(grade) || 0) > courseGradeMaximum(course, grade)) return null;
                const beforeState = hardRuleStateForCourse(event, course, existing);
                const afterState = hardRuleStateForCourse(event, course, after);
                if (!hardRuleStateNoWorse(beforeState, afterState)) return null;
                const balance = Math.round(event.settings.balanceWeight * Math.abs((loads.get(course.id) || 0) + 1 - (targets.get(course.id) || 0)));
                return { course, score: preferenceCost(person, course) - preferenceCost(person, target) + balance };
              })
              .filter(Boolean)
              .sort((a, b) => a.score - b.score || a.course.id.localeCompare(b.course.id, "de"));

            return destinations.length ? { person, toId: destinations[0].course.id, score: destinations[0].score } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const chosen = movable[0];
        if (chosen) {
          assignments.set(chosen.person.id, chosen.toId);
          loads.set(target.id, (loads.get(target.id) || 0) - 1);
          if (chosen.toId) loads.set(chosen.toId, (loads.get(chosen.toId) || 0) + 1);
          changed = true;
          break;
        }

        const swap = bestSwapForViolation(violation, byCourse);
        if (swap) {
          assignments.set(swap.inside.id, swap.fromId);
          assignments.set(swap.outside.id, target.id);
          changed = true;
          break;
        }

        // Eine Jahrgangsgrenze darf keinen Schüler aus einer ansonsten zulässigen
        // Zuteilung herausdrängen. Wenn weder Verschieben noch Tauschen gelingt,
        // übernimmt die globale Suche unten die bestmögliche Annäherung.
        continue;
      }
    }

    if (!changed) {
      if (!globalSearchTried) {
        globalSearchTried = true;
        if (rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads)) continue;
        if (rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed: true })) {
          const remaining = courseGradeLimitViolations(event, openSet, courseMap, assignments);
          if (!remaining.length) continue;
          event.settings.gradeLimitsRelaxed = true;
          return remaining;
        }
      }
      const first = violations[0];
      if (first.kind === "gradeMin") {
        throw new Error(`${first.course.name}${first.course.session ? ` – Gruppe ${first.course.session}` : ""}: Jahrgang ${first.grade} benötigt mindestens ${first.min} Schüler, aktuell sind ${first.count} möglich. Diese harte Jahrgangs-Mindestbelegung kann mit den aktuellen Wünschen, Kapazitäten, Sperrungen und festen Setzungen nicht erfüllt werden.`);
      }
      throw new Error(`${first.course.name}${first.course.session ? ` – Gruppe ${first.course.session}` : ""}: Jahrgang ${first.grade} darf höchstens ${first.max} Schüler enthalten, aktuell sind es ${first.count}. Diese harte Jahrgangs-Maximalbelegung kann mit den aktuellen Vorgaben nicht erfüllt werden.`);
    }
  }

  const remaining = courseGradeLimitViolations(event, openSet, courseMap, assignments);
  if (remaining.length) {
    const first = remaining[0];
    throw new Error(`${first.course.name}: Jahrgangsbelegung konnte nach mehreren Reparaturschritten nicht stabil erfüllt werden.`);
  }
}


function flexibleRuleGroupKey(rule, person) {
  const grade = parseGrade(person.className);
  if (rule.type === "class") return String(person.className || "").trim();
  if (rule.type === "grade") return String(grade);
  if (rule.type === "gradeForm") return `${grade}\u0000${person.schoolForm}`;
  if (rule.type === "gradeAnyForm") return String(grade);
  return "";
}

function flexibleRuleGroupLabel(rule, key) {
  if (rule.type === "class") return `Klasse ${key}`;
  if (rule.type === "grade") return `Jahrgang ${key}`;
  if (rule.type === "gradeForm") {
    const [grade, form] = String(key).split("\u0000");
    return `Jahrgang ${grade} / ${form}`;
  }
  if (rule.type === "gradeAnyForm") return `Jahrgang ${key} (mindestens ein Bildungsgang)`;
  return String(key);
}

function ruleTypeLabel(type) {
  return ({
    class: "Klasse",
    grade: "Jahrgang",
    gradeForm: "Jahrgang + Bildungsgang",
    gradeAnyForm: "Jahrgang: mindestens ein Bildungsgang",
  })[type] || type;
}

function peopleByCourse(event, assignments) {
  const personMap = new Map(event.participants.map((person) => [person.id, person]));
  const map = new Map(event.workshops.map((course) => [course.id, []]));
  for (const [personId, courseId] of assignments) {
    if (!courseId || !map.has(courseId)) continue;
    const person = personMap.get(personId);
    if (person) map.get(courseId).push(person);
  }
  return map;
}

function violationsForFlexibleRule(rule, course, people) {
  if (!rule.enabled || !people.length) return [];
  const groups = new Map();
  for (const person of people) {
    const key = flexibleRuleGroupKey(rule, person);
    if (!key || key === "NaN") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const violations = [];
  if (rule.type !== "gradeAnyForm") {
    for (const [key, members] of groups) {
      if (members.length > 0 && members.length < rule.min) {
        violations.push({ rule, course, key, members, count: members.length, min: rule.min, label: flexibleRuleGroupLabel(rule, key) });
      }
    }
    return violations;
  }

  for (const [gradeKey, members] of groups) {
    const byForm = new Map();
    for (const person of members) {
      if (!byForm.has(person.schoolForm)) byForm.set(person.schoolForm, []);
      byForm.get(person.schoolForm).push(person);
    }
    const formEntries = [...byForm.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "de"));
    const best = formEntries[0];
    const bestCount = best?.[1]?.length || 0;
    if (members.length > 0 && bestCount < rule.min) {
      violations.push({
        rule, course, key: gradeKey, members, count: bestCount, total: members.length, min: rule.min,
        preferredForm: best?.[0] || "", label: flexibleRuleGroupLabel(rule, gradeKey),
      });
    }
  }
  return violations;
}

function flexibleRuleViolations(event, openSet, courseMap, assignments, mode = null) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  const rules = (event.settings.rules || []).filter((rule) => rule.enabled && (!mode || rule.mode === mode));
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    for (const rule of rules) violations.push(...violationsForFlexibleRule(rule, course, byCourse.get(courseId) || []));
  }
  return violations;
}

function hardRuleStateForCourse(event, course, people) {
  const violations = [];
  for (const rule of (event.settings.rules || []).filter((r) => r.enabled && r.mode === "hard")) {
    violations.push(...violationsForFlexibleRule(rule, course, people));
  }
  if (!event.settings.gradeLimitsRelaxed) violations.push(...gradeLimitViolationsForPeople(course, people));
  violations.push(...cohortViolationsForPeople(event, course, people));

  const totalMinDeficit = Math.max(0, effectiveMinimum(course) - people.length);
  const totalMaxExcess = Math.max(0, people.length - course.max);
  const deficit = violations.reduce((sum, violation) => {
    if (violation.kind === "gradeMax") return sum + Math.max(1, violation.count - violation.max);
    return sum + Math.max(1, (violation.min ?? 0) - violation.count);
  }, 0) + totalMinDeficit + totalMaxExcess;

  return {
    count: violations.length + (totalMinDeficit ? 1 : 0) + (totalMaxExcess ? 1 : 0),
    deficit,
  };
}

function hardRuleStateCompare(a, b) {
  if (a.count !== b.count) return a.count - b.count;
  return a.deficit - b.deficit;
}

function hardRuleStateNoWorse(before, after) {
  return hardRuleStateCompare(after, before) <= 0;
}

function hardRuleStateImproves(before, after) {
  return hardRuleStateCompare(after, before) < 0;
}

function moveWouldKeepCourseHardRules(event, course, people) {
  if (people.length < effectiveMinimum(course)) return false;
  return hardRuleStateForCourse(event, course, people).count === 0;
}

function flexibleCandidateMatches(violation, person) {
  const rule = violation.rule;
  if (rule.type === "gradeAnyForm") {
    if (String(parseGrade(person.className)) !== violation.key) return false;
    return !violation.preferredForm || person.schoolForm === violation.preferredForm;
  }
  return flexibleRuleGroupKey(rule, person) === violation.key;
}

function repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, mode = "hard") {
  const maxPasses = Math.max(40, event.workshops.length * 10);
  const preferredBudget = 100_000; // deutlich kleiner als der Sprung Erst- -> Zweitwunsch

  const violationStillPresent = (violation, people) => violationsForFlexibleRule(violation.rule, violation.course, people)
    .some((item) => item.key === violation.key);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const violations = flexibleRuleViolations(event, openSet, courseMap, assignments, mode);
    if (!violations.length) return [];
    violations.sort((a, b) => (a.min - a.count) - (b.min - b.count) || a.course.id.localeCompare(b.course.id, "de"));
    let changed = false;

    for (const violation of violations) {
      const target = violation.course;
      const targetLoad = loads.get(target.id) || 0;
      const byCourse = peopleByCourse(event, assignments);

      // 1) Die zu kleine Gruppe verstärken. Bei harten Regeln dürfen andere bereits
      // vorhandene harte Verletzungen im Zielkurs die Reparatur nicht blockieren.
      // Entscheidend ist, dass jeder Schritt die harte Gesamtsituation verbessert und
      // im abgebenden Kurs nichts verschlechtert.
      if (targetLoad < target.max) {
        const candidates = event.participants
          .filter((person) => !person.fixed && flexibleCandidateMatches(violation, person))
          .filter((person) => {
            const fromId = assignments.get(person.id) || "";
            if (!fromId || fromId === target.id) return false;
            if (!courseEligible(person, target, lockSet, event.settings.allowOutside)) return false;
            return Boolean(courseMap.get(fromId));
          })
          .map((person) => {
            const fromId = assignments.get(person.id) || "";
            const donor = courseMap.get(fromId);
            const preferenceDelta = preferenceCost(person, target) - preferenceCost(person, donor);
            const balanceDelta = Math.round(event.settings.balanceWeight * (
              Math.abs(targetLoad + 1 - (targets.get(target.id) || 0)) - Math.abs(targetLoad - (targets.get(target.id) || 0))
            ));
            return { person, fromId, score: preferenceDelta + balanceDelta };
          })
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const tempByCourse = new Map([...byCourse.entries()].map(([id, people]) => [id, [...people]]));
        const tempLoads = new Map(loads);
        const selected = [];

        for (const candidate of candidates) {
          if ((tempLoads.get(target.id) || 0) >= target.max) break;
          if (mode === "preferred" && candidate.score > preferredBudget) continue;

          const donor = courseMap.get(candidate.fromId);
          const donorBefore = tempByCourse.get(candidate.fromId) || [];
          const donorAfter = donorBefore.filter((person) => person.id !== candidate.person.id);
          if (donorAfter.length < effectiveMinimum(donor)) continue;

          const targetBefore = tempByCourse.get(target.id) || [];
          const targetAfter = [...targetBefore, candidate.person];

          if (mode === "hard") {
            const donorBeforeState = hardRuleStateForCourse(event, donor, donorBefore);
            const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
            const targetBeforeState = hardRuleStateForCourse(event, target, targetBefore);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) continue;
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) continue;
          } else {
            if (!moveWouldKeepCourseHardRules(event, donor, donorAfter)) continue;
            if (!moveWouldKeepCourseHardRules(event, target, targetAfter)) continue;
          }

          selected.push(candidate);
          tempByCourse.set(candidate.fromId, donorAfter);
          tempByCourse.set(target.id, targetAfter);
          tempLoads.set(candidate.fromId, (tempLoads.get(candidate.fromId) || 0) - 1);
          tempLoads.set(target.id, (tempLoads.get(target.id) || 0) + 1);

          if (!violationStillPresent(violation, targetAfter)) break;
        }

        const targetAfterPlan = tempByCourse.get(target.id) || [];
        if (selected.length && !violationStillPresent(violation, targetAfterPlan)) {
          for (const candidate of selected) {
            assignments.set(candidate.person.id, target.id);
            loads.set(candidate.fromId, (loads.get(candidate.fromId) || 0) - 1);
            loads.set(target.id, (loads.get(target.id) || 0) + 1);
          }
          changed = true;
          break;
        }
      }

      // 2) Falls Verstärken nicht geht, die zu kleine Gruppe vollständig aus dem Kurs
      // entfernen. Die Zielkurse dürfen durch diese Reparatur keine harten Regeln
      // verschlechtern. Die Zielgruppe im ursprünglichen Kurs wird als Ganzes bewertet,
      // damit eine 0-oder-mindestens-N-Regel nicht an einem Zwischenstand scheitert.
      const members = violation.members.filter((person) => !person.fixed);
      if (members.length === violation.members.length && (loads.get(target.id) || 0) - members.length >= effectiveMinimum(target)) {
        const targetBeforePeople = byCourse.get(target.id) || [];
        const targetFinalPeople = targetBeforePeople.filter((person) => !violation.members.some((member) => member.id === person.id));
        const targetBeforeState = hardRuleStateForCourse(event, target, targetBeforePeople);
        const targetFinalState = hardRuleStateForCourse(event, target, targetFinalPeople);
        const targetHardOkay = mode === "hard"
          ? hardRuleStateImproves(targetBeforeState, targetFinalState)
          : moveWouldKeepCourseHardRules(event, target, targetFinalPeople);

        if (targetHardOkay) {
          const planned = [];
          const tempLoads = new Map(loads);
          const tempByCourse = new Map([...byCourse.entries()].map(([id, people]) => [id, [...people]]));
          tempByCourse.set(target.id, [...targetFinalPeople]);
          tempLoads.set(target.id, (tempLoads.get(target.id) || 0) - members.length);
          let feasible = true;

          for (const person of members) {
            const destinations = [...openSet]
              .map((id) => courseMap.get(id))
              .filter((course) => course && course.id !== target.id)
              .filter((course) => (tempLoads.get(course.id) || 0) < course.max)
              .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
              .map((course) => {
                const existing = tempByCourse.get(course.id) || [];
                const after = [...existing, person];
                const prefDelta = preferenceCost(person, course) - preferenceCost(person, target);
                const beforeState = hardRuleStateForCourse(event, course, existing);
                const afterState = hardRuleStateForCourse(event, course, after);
                const hardValid = mode === "hard"
                  ? hardRuleStateNoWorse(beforeState, afterState)
                  : moveWouldKeepCourseHardRules(event, course, after);
                return { course, hardValid, prefDelta };
              })
              .filter((item) => item.hardValid)
              .sort((a, b) => a.prefDelta - b.prefDelta || a.course.id.localeCompare(b.course.id, "de"));

            const chosen = destinations[0];
            if (!chosen || (mode === "preferred" && chosen.prefDelta > preferredBudget)) { feasible = false; break; }
            planned.push({ person, toId: chosen.course.id });
            tempLoads.set(chosen.course.id, (tempLoads.get(chosen.course.id) || 0) + 1);
            tempByCourse.set(chosen.course.id, [...(tempByCourse.get(chosen.course.id) || []), person]);
          }

          if (feasible) {
            for (const move of planned) {
              assignments.set(move.person.id, move.toId);
              loads.set(move.toId, (loads.get(move.toId) || 0) + 1);
            }
            loads.set(target.id, (loads.get(target.id) || 0) - members.length);
            changed = true;
            break;
          }
        }
      }
    }

    if (!changed) {
      // Auch eine als verbindlich markierte Zusammensetzungsregel darf nicht dazu
      // führen, dass eine ansonsten mögliche Gesamtlösung verworfen wird.
      return violations;
    }
  }

  const remaining = flexibleRuleViolations(event, openSet, courseMap, assignments, mode);
  return remaining;
}

function summarizeFlexibleRules(event, openSet, courseMap, assignments) {
  const hard = flexibleRuleViolations(event, openSet, courseMap, assignments, "hard");
  const preferred = flexibleRuleViolations(event, openSet, courseMap, assignments, "preferred");
  return { hard, preferred };
}

function nonGradeGroupHardValidForCourse(event, course, people) {
  if (!course) return true;
  if (people.length < effectiveMinimum(course) || people.length > course.max) return false;
  if (!event.settings.gradeLimitsRelaxed && gradeLimitViolationsForPeople(course, people).length) return false;
  if (cohortViolationsForPeople(event, course, people).length) return false;
  for (const rule of (event.settings.rules || []).filter((item) => item.enabled && item.mode === "hard")) {
    if (violationsForFlexibleRule(rule, course, people).length) return false;
  }
  return true;
}

function gradeGroupAssignmentState(event, openSet, courseMap, assignments) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  let distance = 0;
  let imbalance = 0;
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course?.gradeGroupRule?.enabled) continue;
    const people = byCourse.get(courseId) || [];
    const courseViolations = gradeGroupViolationsForPeople(course, people);
    violations.push(...courseViolations);
    distance += courseViolations.reduce((sum, item) => sum + item.distance, 0);
    imbalance += gradeGroupImbalanceForPeople(course, people);
  }
  const unassigned = event.participants.reduce((sum, person) => sum + (assignments.get(person.id) ? 0 : 1), 0);
  return { byCourse, violations, distance, imbalance, unassigned };
}

function assignmentPreferenceCost(person, courseId, courseMap) {
  if (!courseId) return PREFERENCE_COST.unassigned;
  const course = courseMap.get(courseId);
  return course ? preferenceCost(person, course) : PREFERENCE_COST.unassigned;
}

function gradeGroupAssignmentHash(event, assignments) {
  return event.participants.map((person) => assignments.get(person.id) || "").join("\u0002");
}

function gradeGroupCandidateState(event, openSet, courseMap, baseState, changes, preferenceDelta) {
  const nextAssignments = new Map(baseState.assignments);
  const affected = new Set();
  for (const { person, toId } of changes) {
    const fromId = nextAssignments.get(person.id) || "";
    if (fromId) affected.add(fromId);
    if (toId) affected.add(toId);
    nextAssignments.set(person.id, toId);
  }

  const nextAnalysis = gradeGroupAssignmentState(event, openSet, courseMap, nextAssignments);
  for (const courseId of affected) {
    const course = courseMap.get(courseId);
    if (!nonGradeGroupHardValidForCourse(event, course, nextAnalysis.byCourse.get(courseId) || [])) return null;
  }

  return {
    assignments: nextAssignments,
    cost: baseState.cost + preferenceDelta,
    ...nextAnalysis,
  };
}

function gradeGroupMoveDelta(person, fromId, toId, courseMap) {
  return assignmentPreferenceCost(person, toId, courseMap) - assignmentPreferenceCost(person, fromId, courseMap);
}

function gradeGroupActionsForState(event, openSet, lockSet, courseMap, state) {
  const plans = [];
  const loads = new Map([...state.byCourse.entries()].map(([courseId, people]) => [courseId, people.length]));
  const openCourses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const focusedViolations = [...state.violations]
    .sort((a, b) => b.distance - a.distance || a.course.id.localeCompare(b.course.id, "de") || a.key.localeCompare(b.key, "de"));

  for (const violation of focusedViolations) {
    const target = violation.course;
    const groupKey = violation.key;
    const targetPeople = state.byCourse.get(target.id) || [];
    const targetCounts = gradeGroupCountsForPeople(targetPeople);
    const targetDistance = [...targetCounts.values()].reduce((sum, count) => {
      const remainder = count % GRADE_GROUP_SIZE;
      return sum + Math.min(remainder, GRADE_GROUP_SIZE - remainder);
    }, 0);
    const localDistanceAfter = (outGroup, inGroup) => {
      const counts = new Map(targetCounts);
      if (outGroup && counts.has(outGroup)) counts.set(outGroup, Math.max(0, (counts.get(outGroup) || 0) - 1));
      if (inGroup && counts.has(inGroup)) counts.set(inGroup, (counts.get(inGroup) || 0) + 1);
      return [...counts.values()].reduce((sum, count) => {
        const remainder = count % GRADE_GROUP_SIZE;
        return sum + Math.min(remainder, GRADE_GROUP_SIZE - remainder);
      }, 0);
    };
    const members = targetPeople
      .filter((person) => !person.fixed && gradeGroupForGrade(parseGrade(person.className))?.key === groupKey)
      .sort((a, b) => a.id.localeCompare(b.id, "de"));

    // Einzelne Person aus der zu reparierenden Jahrgangsgruppe in einen anderen
    // zulässigen Kurs verschieben. Ein Ziel ohne Kurs wird bewusst nicht erzeugt:
    // Teilbarkeit darf keine bestehende Zuteilung entfernen.
    for (const person of members.slice(0, 36)) {
      const destinations = openCourses
        .filter((course) => course.id !== target.id)
        .filter((course) => (loads.get(course.id) || 0) < course.max)
        .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
        .map((course) => ({
          toId: course.id,
          delta: gradeGroupMoveDelta(person, target.id, course.id, courseMap),
        }))
        .sort((a, b) => a.delta - b.delta || a.toId.localeCompare(b.toId, "de"))
        .slice(0, 4);
      for (const destination of destinations) {
        plans.push({
          changes: [{ person, toId: destination.toId }],
          delta: destination.delta,
          estimatedDelta: localDistanceAfter(groupKey, null) - targetDistance,
        });
      }
    }

    // Passende Person aus einem anderen Kurs in die zu reparierende Gruppe holen.
    if ((loads.get(target.id) || 0) < target.max) {
      const outsiders = event.participants
        .filter((person) => !person.fixed && (state.assignments.get(person.id) || "") !== target.id)
        .filter((person) => gradeGroupForGrade(parseGrade(person.className))?.key === groupKey)
        .filter((person) => courseEligible(person, target, lockSet, event.settings.allowOutside))
        .map((person) => {
          const fromId = state.assignments.get(person.id) || "";
          return { person, fromId, delta: gradeGroupMoveDelta(person, fromId, target.id, courseMap) };
        })
        .sort((a, b) => a.delta - b.delta || a.person.id.localeCompare(b.person.id, "de"))
        .slice(0, 48);

      for (const item of outsiders) {
        plans.push({
          changes: [{ person: item.person, toId: target.id }],
          delta: item.delta,
          estimatedDelta: localDistanceAfter(null, groupKey) - targetDistance,
        });
      }
    }

    // Bei voller bzw. exakt belegter Durchführung kann ein Tausch beide
    // Jahrgangsgruppen in einem atomaren Schritt korrigieren.
    const swapInsiders = targetPeople.filter((person) => !person.fixed).slice(0, 28);
    const swapOutsiders = event.participants
      .filter((person) => !person.fixed && (state.assignments.get(person.id) || "") !== target.id)
      .filter((person) => courseEligible(person, target, lockSet, event.settings.allowOutside))
      .map((person) => {
        const fromId = state.assignments.get(person.id) || "";
        return { person, fromId, deltaToTarget: gradeGroupMoveDelta(person, fromId, target.id, courseMap) };
      })
      .sort((a, b) => a.deltaToTarget - b.deltaToTarget || a.person.id.localeCompare(b.person.id, "de"))
      .slice(0, 36);

    for (const inside of swapInsiders) {
      const insideGroup = gradeGroupForGrade(parseGrade(inside.className))?.key || "other";
      for (const outside of swapOutsiders) {
        const outsideGroup = gradeGroupForGrade(parseGrade(outside.person.className))?.key || "other";
        if (insideGroup === outsideGroup) continue;
        const estimatedDelta = localDistanceAfter(insideGroup, outsideGroup) - targetDistance;
        if (estimatedDelta >= 0) continue;
        if (outside.fromId) {
          const donor = courseMap.get(outside.fromId);
          if (!donor || !courseEligible(inside, donor, lockSet, event.settings.allowOutside)) continue;
        }
        const delta = gradeGroupMoveDelta(inside, target.id, outside.fromId, courseMap)
          + gradeGroupMoveDelta(outside.person, outside.fromId, target.id, courseMap);
        plans.push({
          changes: [
            { person: inside, toId: outside.fromId },
            { person: outside.person, toId: target.id },
          ],
          delta,
          estimatedDelta,
        });
      }
    }
  }

  const actions = [];
  const orderedPlans = plans.sort((a, b) => a.estimatedDelta - b.estimatedDelta || a.delta - b.delta).slice(0, 260);
  for (const plan of orderedPlans) {
    const candidate = gradeGroupCandidateState(event, openSet, courseMap, state, plan.changes, plan.delta);
    if (!candidate || candidate.distance > state.distance + 1) continue;
    actions.push(candidate);
    if (actions.length >= 80) break;
  }
  return actions.sort(compareGradeGroupStates);
}

function compareGradeGroupStates(a, b) {
  return a.unassigned - b.unassigned
    || a.violations.length - b.violations.length
    || a.distance - b.distance
    || a.cost - b.cost
    || a.imbalance - b.imbalance;
}

function repairGradeGroups(event, openSet, lockSet, courseMap, assignments, loads) {
  const enabled = [...openSet].some((courseId) => courseMap.get(courseId)?.gradeGroupRule?.enabled);
  if (!enabled) return;

  const initialAnalysis = gradeGroupAssignmentState(event, openSet, courseMap, assignments);
  if (!initialAnalysis.violations.length) return;

  const initial = { assignments: new Map(assignments), cost: 0, ...initialAnalysis };
  const maxDepth = Math.min(18, Math.max(6, initial.violations.length * 3 + initial.distance * 2));
  const beamWidth = 40;
  let frontier = [initial];
  const seen = new Map([[gradeGroupAssignmentHash(event, initial.assignments), 0]]);
  let solution = null;
  let bestFallback = initial;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const bestAtDepth = [...frontier].sort(compareGradeGroupStates)[0];
    if (bestAtDepth && compareGradeGroupStates(bestAtDepth, bestFallback) < 0) bestFallback = bestAtDepth;
    const complete = frontier
      .filter((state) => state.distance === 0)
      .sort(compareGradeGroupStates)[0];
    if (complete) { solution = complete; break; }
    if (depth === maxDepth) break;

    const next = [];
    for (const state of frontier) {
      for (const candidate of gradeGroupActionsForState(event, openSet, lockSet, courseMap, state)) {
        const hash = gradeGroupAssignmentHash(event, candidate.assignments);
        const previousCost = seen.get(hash);
        if (previousCost !== undefined && previousCost <= candidate.cost) continue;
        seen.set(hash, candidate.cost);
        next.push(candidate);
      }
    }
    frontier = next
      .sort(compareGradeGroupStates)
      .slice(0, beamWidth);
    if (!frontier.length) break;
  }

  // Ist keine exakte Teilbarkeit erreichbar, wird die beste gefundene vollständige
  // Zuteilung übernommen und später mit einem konkreten Hinweis ausgegeben.
  solution ||= bestFallback;

  assignments.clear();
  for (const [personId, courseId] of solution.assignments) assignments.set(personId, courseId);
  for (const courseId of loads.keys()) loads.set(courseId, 0);
  for (const courseId of assignments.values()) if (courseId && loads.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
}

const TRADEOFF_WISH_COST = Object.freeze([0, 1, 5, 15, 30]);

function assignmentWishMetrics(event, courseMap, assignments) {
  let penalty = 0;
  let unassigned = 0;
  for (const person of event.participants) {
    const courseId = assignments.get(person.id) || "";
    const course = courseId ? courseMap.get(courseId) : null;
    if (!course) {
      unassigned += 1;
      continue;
    }
    if (person.fixed === course.id) continue;
    penalty += TRADEOFF_WISH_COST[rankBucket(person, course)] ?? TRADEOFF_WISH_COST[4];
  }
  return { wishPenalty: penalty, unassigned };
}

function distributionRuleMetrics(event, openSet, courseMap, assignments) {
  const groupedPeople = peopleByCourse(event, assignments);
  const gradeViolations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
  const groupState = gradeGroupAssignmentState(event, openSet, courseMap, assignments);
  const cohortViolations = findCohortViolations(event, openSet, courseMap, assignments).violations;
  const flexible = summarizeFlexibleRules(event, openSet, courseMap, assignments);
  const hardFlexibleDeviation = flexible.hard.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const preferredFlexibleDeviation = flexible.preferred.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const gradeDeviation = gradeViolations.reduce((sum, violation) => sum + (
    violation.kind === "gradeMax" ? violation.count - violation.max : violation.min - violation.count
  ), 0);
  const cohortDeviation = cohortViolations.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const imbalance = [...openSet].reduce((sum, courseId) => {
    const course = courseMap.get(courseId);
    if (!course) return sum;
    return sum + gradeGroupImbalanceForPeople(course, groupedPeople.get(courseId) || []);
  }, 0);
  const hardViolationCount = gradeViolations.length + groupState.violations.length + cohortViolations.length + flexible.hard.length;
  const preferredViolationCount = flexible.preferred.length;
  const hardDeviation = gradeDeviation + groupState.distance + cohortDeviation + hardFlexibleDeviation;
  const preferredDeviation = preferredFlexibleDeviation + imbalance;

  return {
    hardViolationCount,
    preferredViolationCount,
    hardDeviation,
    preferredDeviation,
    // Innerhalb der Regel-Seite zählen „Vorrangig“ und konkrete
    // Jahrgangsgrenzen stärker als bevorzugte Verteilungsziele.
    rulePenalty: hardViolationCount * 6 + hardDeviation * 4 + preferredViolationCount * 2 + preferredDeviation,
  };
}

function restoreAssignmentSnapshot(snapshot, assignments, loads) {
  assignments.clear();
  for (const [personId, courseId] of snapshot.assignments) assignments.set(personId, courseId);
  for (const courseId of loads.keys()) loads.set(courseId, snapshot.loads.get(courseId) || 0);
}

function selectDistributionSnapshot(event, openSet, courseMap, snapshots) {
  const weight = Math.max(0, Math.min(100, Number(event.settings.gradePreferenceWeight) || 0));
  const analyzed = snapshots.map((snapshot, index) => ({
    ...snapshot,
    index,
    ...assignmentWishMetrics(event, courseMap, snapshot.assignments),
    ...distributionRuleMetrics(event, openSet, courseMap, snapshot.assignments),
  }));
  const minimumUnassigned = Math.min(...analyzed.map((snapshot) => snapshot.unassigned));
  const completeFirst = analyzed.filter((snapshot) => snapshot.unassigned === minimumUnassigned);
  const wishes = completeFirst.map((snapshot) => snapshot.wishPenalty);
  const rules = completeFirst.map((snapshot) => snapshot.rulePenalty);
  const minWish = Math.min(...wishes);
  const maxWish = Math.max(...wishes);
  const minRule = Math.min(...rules);
  const maxRule = Math.max(...rules);
  const normalized = (value, min, max) => max === min ? 0 : (value - min) / (max - min);

  return completeFirst.sort((a, b) => {
    const aScore = (100 - weight) * normalized(a.wishPenalty, minWish, maxWish)
      + weight * normalized(a.rulePenalty, minRule, maxRule);
    const bScore = (100 - weight) * normalized(b.wishPenalty, minWish, maxWish)
      + weight * normalized(b.rulePenalty, minRule, maxRule);
    if (aScore !== bScore) return aScore - bScore;
    if (weight >= 50) {
      return a.rulePenalty - b.rulePenalty || a.wishPenalty - b.wishPenalty || b.index - a.index;
    }
    return a.wishPenalty - b.wishPenalty || a.rulePenalty - b.rulePenalty || a.index - b.index;
  })[0];
}

function optimizeEventSingle(raw) {
  const { event, errors, warnings } = validateEvent(raw);
  if (errors.length) return { ok: false, errors, warnings };

  try {
    const courseMap = new Map(event.workshops.map((course) => [course.id, course]));
    const personMap = new Map(event.participants.map((person) => [person.id, person]));
    const lockSet = new Set(event.locks.filter((l) => l.personId && l.workshopId).map((l) => `${l.personId}\u0000${l.workshopId}`));
    const openSet = determineOpenCourses(event, lockSet, courseMap);
    const assignments = new Map();
    const loads = new Map(event.workshops.map((course) => [course.id, 0]));

    for (const person of event.participants) {
      if (person.fixed) {
        assignments.set(person.id, person.fixed);
        loads.set(person.fixed, (loads.get(person.fixed) || 0) + 1);
      }
    }

    const fixed = fixedLoads(event, courseMap);
    const targets = calculateTargets(event, openSet, courseMap, fixed);
    assignMinimums(event, openSet, lockSet, courseMap, assignments, loads);
    assignRemaining(event, openSet, lockSet, courseMap, assignments, loads, targets);
    const distributionSnapshots = [];
    const keepDistributionSnapshot = (label) => distributionSnapshots.push({
      label,
      assignments: new Map(assignments),
      loads: new Map(loads),
    });
    const runDistributionStage = (label, repair) => {
      const before = { assignments: new Map(assignments), loads: new Map(loads) };
      try {
        repair();
        keepDistributionSnapshot(label);
      } catch {
        // Zusammensetzungsregeln sind bestmögliche Ziele. Scheitert ein
        // Reparaturschritt, bleibt die letzte vollständige zulässige Verteilung
        // als Kandidat erhalten; die Abweichung wird später konkret ausgewiesen.
        restoreAssignmentSnapshot(before, assignments, loads);
      }
    };

    keepDistributionSnapshot("Wünsche");
    runDistributionStage("Kohorten", () => repairCohortMinimums(event, openSet, lockSet, courseMap, assignments, loads, targets));
    runDistributionStage("Jahrgangsgrenzen", () => repairCourseGradeLimits(event, openSet, lockSet, courseMap, assignments, loads, targets));
    runDistributionStage("Vorrangige Regeln", () => repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, "hard"));
    runDistributionStage("Bevorzugte Regeln", () => repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, "preferred"));
    runDistributionStage("Jahrgangsgruppen", () => repairGradeGroups(event, openSet, lockSet, courseMap, assignments, loads));

    const selectedDistribution = selectDistributionSnapshot(event, openSet, courseMap, distributionSnapshots);
    restoreAssignmentSnapshot(selectedDistribution, assignments, loads);

    const finalPeopleByCourse = peopleByCourse(event, assignments);
    const finalGradeLimitViolations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
    const finalGradeGroupViolations = gradeGroupAssignmentState(event, openSet, courseMap, assignments).violations;
    const finalCohortViolations = findCohortViolations(event, openSet, courseMap, assignments).violations;
    const ruleSummary = summarizeFlexibleRules(event, openSet, courseMap, assignments);
    const allRuleViolations = [...ruleSummary.hard, ...ruleSummary.preferred];
    const courseRuleHints = new Map();
    const addCourseHint = (courseId, message) => {
      if (!courseRuleHints.has(courseId)) courseRuleHints.set(courseId, []);
      const hints = courseRuleHints.get(courseId);
      if (!hints.includes(message)) hints.push(message);
    };
    const deviationMessages = [];

    for (const violation of finalGradeLimitViolations) {
      const bound = violation.kind === "gradeMax" ? `höchstens ${violation.max}` : `mindestens ${violation.min}`;
      const detail = `Jg. ${violation.grade}: ${violation.count} statt ${bound}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of finalGradeGroupViolations) {
      const detail = `${violation.label}: ${violation.count}; Gruppengröße ${violation.groupSize}, Abweichung ${violation.distance}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of finalCohortViolations) {
      const detail = `${cohortLabelFromKey(violation.cohortKey)}: ${violation.count} statt mindestens ${violation.min}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of allRuleViolations) {
      const detail = `${violation.label}: ${violation.count} statt mindestens ${violation.min}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }

    if (deviationMessages.length) {
      const details = deviationMessages.slice(0, 10);
      const more = deviationMessages.length > details.length ? `; ${deviationMessages.length - details.length} weitere Abweichung(en)` : "";
      warnings.push(`Bestmögliche Zuteilung mit ${deviationMessages.length} Regelabweichung(en): ${details.join("; ")}${more}. Kein Schüler wurde allein zur Einhaltung dieser Regeln aus einer zulässigen Zuteilung entfernt.`);
    }

    const participantResults = event.participants.map((person) => {
      const courseId = assignments.get(person.id) || "";
      const course = courseId ? courseMap.get(courseId) : null;
      const type = rankLabel(person, course);
      const noteParts = [];
      if (type === "Nicht zugeteilt") noteParts.push("Kein zulässiger Platz verfügbar – Kapazitäten, Kurszugang und Wünsche prüfen");
      else if (type === "Kein Wunsch") noteParts.push("Außerhalb der vier Wünsche");
      const ruleHints = courseId ? courseRuleHints.get(courseId) || [] : [];
      if (ruleHints.length) noteParts.push(`Zugeordnet mit Regelhinweis: ${ruleHints.join("; ")}`);
      return {
        personId: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        className: person.className,
        schoolForm: person.schoolForm,
        workshopId: courseId,
        offerId: course?.offerId || "",
        workshopName: course ? `${course.name}${course.session ? ` – Gruppe ${course.session}` : ""}` : "",
        courseTypeName: course?.name || "",
        session: course?.session || "",
        type,
        note: noteParts.join(" · "),
      };
    });
    const unassignedCount = participantResults.filter((person) => person.type === "Nicht zugeteilt").length;
    if (unassignedCount) {
      warnings.push(`${unassignedCount} Schüler konnten nicht zugeteilt werden, weil für sie kein zulässiger freier Kursplatz vorhanden war. Regelvorgaben allein führen nicht mehr zu einer Nichtzuteilung.`);
    }

    const courseResults = event.workshops.map((course) => {
      const open = openSet.has(course.id);
      const load = loads.get(course.id) || 0;
      const target = open ? targets.get(course.id) || 0 : 0;
      const min = open ? effectiveMinimum(course) : 0;
      return {
        ...course,
        open,
        effectiveMin: min,
        target,
        load,
        deviation: open ? load - target : 0,
        cohortMinEffective: open ? effectiveCohortMinimum(event, course) : 0,
        cohorts: open ? cohortSummaryForCourse(event, course, assignments, personMap) : [],
        gradeLimitSummary: open ? gradeLimitEntries(course).map((limit) => ({
          ...limit,
          count: [...assignments.entries()].reduce((sum, [personId, assignedCourse]) => {
            if (assignedCourse !== course.id) return sum;
            const person = personMap.get(personId);
            return sum + (person && parseGrade(person.className) === limit.grade ? 1 : 0);
          }, 0),
        })) : [],
        gradeGroupSummary: open ? gradeGroupSummaryForPeople(course, finalPeopleByCourse.get(course.id) || []) : [],
        gradeGroupImbalance: open ? gradeGroupImbalanceForPeople(course, finalPeopleByCourse.get(course.id) || []) : 0,
        status: open ? "Findet statt" : "Entfällt (optional)",
      };
    });

    for (const course of courseResults) {
      const courseViolations = allRuleViolations.filter((item) => item.course.id === course.id);
      const groupViolations = finalGradeGroupViolations.filter((item) => item.course.id === course.id);
      const courseGradeViolations = finalGradeLimitViolations.filter((item) => item.course.id === course.id);
      const courseCohortViolations = finalCohortViolations.filter((item) => item.course.id === course.id);
      course.ruleHardViolations = courseViolations.filter((item) => item.rule.mode === "hard").length
        + groupViolations.length
        + courseGradeViolations.length
        + courseCohortViolations.length;
      course.rulePreferredViolations = courseViolations.filter((item) => item.rule.mode === "preferred").length;
      course.ruleDeviations = course.ruleHardViolations + course.rulePreferredViolations;
      course.ruleStatus = course.ruleDeviations ? "Bestmögliche Abweichung" : "Regeln erfüllt";
      course.ruleHints = courseRuleHints.get(course.id) || [];
      course.ruleDetails = courseViolations.map((item) => ({
        mode: item.rule.mode, type: item.rule.type, min: item.min, label: item.label, count: item.count,
      }));
    }

    const counts = new Map();
    for (const result of participantResults) counts.set(result.type, (counts.get(result.type) || 0) + 1);
    const openCourses = courseResults.filter((course) => course.open);
    const meanDeviation = openCourses.length
      ? openCourses.reduce((sum, course) => sum + Math.abs(course.deviation), 0) / openCourses.length
      : 0;

    const badWishByCourse = openCourses.map((course) => {
      const rows = participantResults.filter((person) => person.workshopId === course.id);
      return {
        courseId: course.id,
        third: rows.filter((person) => person.type === "Drittwunsch").length,
        fourth: rows.filter((person) => person.type === "Viertwunsch").length,
      };
    });
    const maxThirdPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.third)) : 0;
    const maxFourthPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.fourth)) : 0;
    const thirdConcentration = badWishByCourse.reduce((sum, item) => sum + item.third * item.third, 0);
    const fourthConcentration = badWishByCourse.reduce((sum, item) => sum + item.fourth * item.fourth, 0);
    const gradeGroupImbalance = openCourses.reduce((sum, course) => sum + (course.gradeGroupImbalance || 0), 0);
    const hardRuleViolations = courseResults.reduce((sum, course) => sum + (course.ruleHardViolations || 0), 0);
    const preferredRuleViolations = courseResults.reduce((sum, course) => sum + (course.rulePreferredViolations || 0), 0);
    const ruleViolationCount = hardRuleViolations + preferredRuleViolations;
    const gradeLimitDeviation = finalGradeLimitViolations.reduce((sum, violation) => sum + (
      violation.kind === "gradeMax" ? violation.count - violation.max : violation.min - violation.count
    ), 0);
    const gradeGroupDeviation = finalGradeGroupViolations.reduce((sum, violation) => sum + violation.distance, 0);
    const cohortDeviation = finalCohortViolations.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
    const flexibleRuleDeviation = allRuleViolations.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
    const ruleDeviationScore = gradeLimitDeviation + gradeGroupDeviation + cohortDeviation + flexibleRuleDeviation;

    return {
      ok: true,
      event,
      warnings,
      participantResults,
      courseResults,
      stats: {
        participants: event.participants.length,
        workshops: event.workshops.length,
        openCourses: openCourses.length,
        first: counts.get("Erstwunsch") || 0,
        second: counts.get("Zweitwunsch") || 0,
        third: counts.get("Drittwunsch") || 0,
        fourth: counts.get("Viertwunsch") || 0,
        fixed: counts.get("Feste Setzung") || 0,
        outside: counts.get("Kein Wunsch") || 0,
        unassigned: counts.get("Nicht zugeteilt") || 0,
        gradePreferenceWeight: event.settings.gradePreferenceWeight,
        distributionChoice: selectedDistribution.label,
        wishTradeoffPenalty: selectedDistribution.wishPenalty,
        ruleTradeoffPenalty: selectedDistribution.rulePenalty,
        meanDeviation,
        gradeGroupImbalance,
        preferredRuleViolations,
        hardRuleViolations,
        ruleViolationCount,
        ruleDeviationScore,
        gradeLimitDeviation,
        gradeGroupDeviation,
        maxThirdPerCourse,
        maxFourthPerCourse,
        thirdConcentration,
        fourthConcentration,
        largeCourseSpread: (() => {
          const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);
          const loadsLarge = openCourses
            .filter((course) => threshold <= 0 || course.max > threshold)
            .map((course) => course.load);
          return loadsLarge.length ? Math.max(...loadsLarge) - Math.min(...loadsLarge) : 0;
        })(),
      },
      personMap,
      courseMap,
    };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings };
  }
}


function qualityRunCount(mode) {
  if (mode === "fast") return 1;
  if (mode === "thorough") return 24;
  return 6;
}

function deterministicHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function variantForQualityRun(raw, runIndex) {
  if (runIndex === 0) return raw;
  const participants = [...(raw?.participants ?? [])].sort((a, b) => {
    const ha = deterministicHash(`${runIndex}|${a?.id ?? ""}|${a?.lastName ?? ""}`);
    const hb = deterministicHash(`${runIndex}|${b?.id ?? ""}|${b?.lastName ?? ""}`);
    return ha - hb || String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "de", { numeric: true });
  });
  const workshops = [...(raw?.workshops ?? [])];
  if (runIndex % 3 === 1) workshops.reverse();
  else if (runIndex % 3 === 2) workshops.sort((a, b) => deterministicHash(`${runIndex}|${a?.id ?? ""}`) - deterministicHash(`${runIndex}|${b?.id ?? ""}`));
  return { ...raw, participants, workshops };
}

function qualityTieTuple(result, weight) {
  const s = result?.stats ?? {};
  const wishesFirst = [-(s.wishTradeoffPenalty ?? 0), -(s.ruleTradeoffPenalty ?? 0)];
  const rulesFirst = [-(s.ruleTradeoffPenalty ?? 0), -(s.wishTradeoffPenalty ?? 0)];
  return [
    ...(weight >= 50 ? rulesFirst : wishesFirst),
    -(s.outside ?? 0),
    -(s.fourth ?? 0),
    -(s.third ?? 0),
    s.first ?? 0,
    s.second ?? 0,
    -(s.maxFourthPerCourse ?? 0),
    -(s.fourthConcentration ?? 0),
    -(s.maxThirdPerCourse ?? 0),
    -(s.thirdConcentration ?? 0),
    -(s.largeCourseSpread ?? 0),
    -(s.meanDeviation ?? 0),
  ];
}

function selectBestQualityResult(candidates, rawWeight) {
  if (!candidates.length) return null;
  const weight = Math.max(0, Math.min(100, Number.isFinite(Number(rawWeight)) ? Number(rawWeight) : 50));
  const minimumUnassigned = Math.min(...candidates.map((candidate) => candidate.stats?.unassigned ?? 0));
  const eligible = candidates.filter((candidate) => (candidate.stats?.unassigned ?? 0) === minimumUnassigned);
  const wishValues = eligible.map((candidate) => candidate.stats?.wishTradeoffPenalty ?? 0);
  const ruleValues = eligible.map((candidate) => candidate.stats?.ruleTradeoffPenalty ?? 0);
  const minWish = Math.min(...wishValues);
  const maxWish = Math.max(...wishValues);
  const minRule = Math.min(...ruleValues);
  const maxRule = Math.max(...ruleValues);
  const normalized = (value, min, max) => max === min ? 0 : (value - min) / (max - min);

  return eligible.sort((a, b) => {
    const aWish = a.stats?.wishTradeoffPenalty ?? 0;
    const bWish = b.stats?.wishTradeoffPenalty ?? 0;
    const aRule = a.stats?.ruleTradeoffPenalty ?? 0;
    const bRule = b.stats?.ruleTradeoffPenalty ?? 0;
    const aScore = (100 - weight) * normalized(aWish, minWish, maxWish) + weight * normalized(aRule, minRule, maxRule);
    const bScore = (100 - weight) * normalized(bWish, minWish, maxWish) + weight * normalized(bRule, minRule, maxRule);
    if (aScore !== bScore) return aScore - bScore;
    const aTuple = qualityTieTuple(a, weight);
    const bTuple = qualityTieTuple(b, weight);
    for (let index = 0; index < aTuple.length; index += 1) {
      if (aTuple[index] !== bTuple[index]) return bTuple[index] - aTuple[index];
    }
    return 0;
  })[0];
}

export function optimizeEvent(raw) {
  const mode = ["fast", "standard", "thorough"].includes(raw?.settings?.qualityMode)
    ? raw.settings.qualityMode
    : "standard";
  const runs = qualityRunCount(mode);
  const started = Date.now();
  const candidates = [];
  let firstFailure = null;
  let successfulRuns = 0;

  for (let run = 0; run < runs; run += 1) {
    const candidate = optimizeEventSingle(variantForQualityRun(raw, run));
    if (!candidate.ok) {
      if (!firstFailure) firstFailure = candidate;
      continue;
    }
    successfulRuns += 1;
    candidate._qualityRun = run + 1;
    candidates.push(candidate);
  }

  // Wenn harte Jahrgangs-Minima bereits die Vorprüfung unmöglich machen,
  // folgt ein eigener Bestmöglich-Durchlauf. Alle übrigen Kapazitäten,
  // Sperrungen, festen Setzungen und harten Regeln bleiben verbindlich.
  if (!candidates.length && raw?.settings?.gradeLimitsRelaxed !== true) {
    const relaxedRaw = {
      ...raw,
      settings: { ...(raw?.settings || {}), gradeLimitsRelaxed: true },
    };
    for (let run = 0; run < runs; run += 1) {
      const candidate = optimizeEventSingle(variantForQualityRun(relaxedRaw, run));
      if (!candidate.ok) continue;
      successfulRuns += 1;
      candidate._qualityRun = run + 1;
      candidates.push(candidate);
    }
  }

  const best = selectBestQualityResult(candidates, raw?.settings?.gradePreferenceWeight);
  if (!best) return firstFailure || optimizeEventSingle(raw);
  const selectedRun = best._qualityRun || 1;
  delete best._qualityRun;
  best.quality = {
    mode,
    runsTried: runs,
    successfulRuns,
    selectedRun,
    elapsedMs: Date.now() - started,
  };
  return best;
}
