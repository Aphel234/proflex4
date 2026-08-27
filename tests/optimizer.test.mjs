import test from "node:test";
import assert from "node:assert/strict";
import { createSampleData } from "../src/sample-data.js";
import { normalizeEvent, optimizeEvent, validateEvent } from "../src/optimizer.js";

test("Beispieldaten sind valide, berechenbar und enthalten zwei Drachenboot-Durchführungen", () => {
  const data = createSampleData();
  const validation = validateEvent(data);
  assert.deepEqual(validation.errors, []);
  assert.equal(new Set(data.workshops.map((w) => w.offerId)).size, 15);
  assert.equal(data.workshops.filter((w) => w.offerId === "W10").length, 2);

  const result = optimizeEvent(data);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.participantResults.length, 100);
  assert.equal(result.courseResults.length, 16);
  assert.equal(result.courseResults.filter((course) => course.mode === "Pflicht" && !course.open).length, 0);
  assert.equal(result.courseResults.filter((course) => course.open && course.load < course.effectiveMin).length, 0);
  assert.equal(result.participantResults.filter((person) => person.type === "Nicht zugeteilt").length, 0);

  for (const course of result.courseResults.filter((c) => c.cohortMinEffective > 0)) {
    assert.ok(course.cohorts.every((cohort) => cohort.count >= course.cohortMinEffective));
  }
});

test("Zwei Durchführungen derselben Kursart zählen beide als derselbe Erstwunsch", () => {
  const data = {
    name: "Doppelter Kurs",
    settings: { allowOutside: false, defaultMode: "Pflicht", balanceWeight: 1, cohortMin: 2 },
    workshops: [
      { id: "D-A", offerId: "D", name: "Drachenboot", session: "A", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 2, max: 4, mode: "Pflicht", cohortMin: null },
      { id: "D-B", offerId: "D", name: "Drachenboot", session: "B", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 2, max: 4, mode: "Pflicht", cohortMin: null },
    ],
    participants: Array.from({ length: 4 }, (_, i) => ({ id: `P${i + 1}`, firstName: `V${i + 1}`, lastName: `N${i + 1}`, className: "9a", schoolForm: "Regional", wishes: ["D", "", "", ""], fixed: "" })),
    locks: [],
  };
  const result = optimizeEvent(data);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.deepEqual(result.courseResults.map((c) => c.load).sort(), [2, 2]);
  assert.ok(result.participantResults.every((p) => p.type === "Erstwunsch"));
});

test("Kohortenminimum Jahrgang plus Bildungsgang wird eingehalten", () => {
  const data = {
    name: "Kohorte",
    settings: { allowOutside: false, defaultMode: "Pflicht", balanceWeight: 1, cohortMin: 3 },
    workshops: [{ id: "A", offerId: "A", name: "Kurs A", session: "A", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 3, max: 6, mode: "Pflicht", cohortMin: null }],
    participants: Array.from({ length: 3 }, (_, i) => ({ id: `P${i}`, firstName: "A", lastName: String(i), className: "8a", schoolForm: "Gymnasial", wishes: ["A", "", "", ""], fixed: "" })),
    locks: [],
  };
  const result = optimizeEvent(data);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.courseResults[0].cohorts[0].count, 3);
});

test("Nicht erfüllbares Kohortenminimum liefert eine vollständige Bestmöglich-Zuteilung", () => {
  const data = {
    name: "Kohorte unmöglich",
    settings: { allowOutside: false, defaultMode: "Pflicht", balanceWeight: 1, cohortMin: 3 },
    workshops: [{ id: "A", offerId: "A", name: "Kurs A", session: "A", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 1, max: 5, mode: "Pflicht", cohortMin: null }],
    participants: [
      { id: "P1", firstName: "A", lastName: "1", className: "8a", schoolForm: "Gymnasial", wishes: ["A", "", "", ""], fixed: "" },
      { id: "P2", firstName: "A", lastName: "2", className: "9a", schoolForm: "Regional", wishes: ["A", "", "", ""], fixed: "" },
    ],
    locks: [],
  };
  const result = optimizeEvent(data);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.stats.unassigned, 0);
  assert.ok(result.stats.ruleViolationCount >= 1);
  assert.match(result.warnings.join(" "), /Bestmögliche Zuteilung.*Regelabweichung/i);
});

test("Pflichtkurs mit unerreichbarer Mindestbelegung wird abgelehnt", () => {
  const data = createSampleData();
  data.workshops[0].min = 500;
  data.workshops[0].max = 500;
  const result = optimizeEvent(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("Optionale Durchführungen dürfen entfallen", () => {
  const data = createSampleData();
  data.workshops.push({ id: "W99", offerId: "W99", name: "Zusatzkurs", session: "A", gradeFrom: 12, gradeTo: 12, schoolForm: "Regional", min: 10, max: 12, mode: "Optional", cohortMin: 0 });
  const result = optimizeEvent(data);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  const course = result.courseResults.find((row) => row.id === "W99");
  assert.equal(course.open, false);
});

test('Bevorzugte Klassenregel blockiert die Lösung nicht', () => {
  const event = {
    name: 'Soft rule',
    settings: { allowOutside: false, balanceWeight: 10, balanceThreshold: 10, cohortMin: 0,
      rules: [{ id: 'R1', type: 'class', min: 3, mode: 'preferred', enabled: true }] },
    workshops: [
      { id: 'W1', offerId: 'K1', name: 'A', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 10, mode: 'Pflicht', cohortMin: null },
      { id: 'W2', offerId: 'K2', name: 'B', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 10, mode: 'Pflicht', cohortMin: null },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: 'A', className: '7a', schoolForm: 'Regional', wishes: ['K1','K2','',''], fixed: '' },
      { id: 'P2', firstName: 'B', lastName: 'B', className: '8a', schoolForm: 'Regional', wishes: ['K1','K2','',''], fixed: '' },
      { id: 'P3', firstName: 'C', lastName: 'C', className: '9a', schoolForm: 'Regional', wishes: ['K2','K1','',''], fixed: '' },
      { id: 'P4', firstName: 'D', lastName: 'D', className: '10a', schoolForm: 'Regional', wishes: ['K2','K1','',''], fixed: '' },
    ], locks: []
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true);
  assert.ok(result.stats.preferredRuleViolations >= 0);
});

test('Vorrangige Jahrgangsregel wird erfüllt oder als Bestmöglich-Abweichung ausgegeben', () => {
  const event = {
    name: 'Hard rule',
    settings: { allowOutside: false, balanceWeight: 10, balanceThreshold: 10, cohortMin: 0,
      rules: [{ id: 'R1', type: 'grade', min: 2, mode: 'hard', enabled: true }] },
    workshops: [
      { id: 'W1', offerId: 'K1', name: 'A', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 10, mode: 'Pflicht', cohortMin: null },
      { id: 'W2', offerId: 'K2', name: 'B', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 10, mode: 'Pflicht', cohortMin: null },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: 'A', className: '7a', schoolForm: 'Regional', wishes: ['K1','K2','',''], fixed: '' },
      { id: 'P2', firstName: 'B', lastName: 'B', className: '7b', schoolForm: 'Gymnasial', wishes: ['K2','K1','',''], fixed: '' },
      { id: 'P3', firstName: 'C', lastName: 'C', className: '8a', schoolForm: 'Regional', wishes: ['K1','K2','',''], fixed: '' },
      { id: 'P4', firstName: 'D', lastName: 'D', className: '8b', schoolForm: 'Gymnasial', wishes: ['K2','K1','',''], fixed: '' },
    ], locks: []
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.unassigned, 0);
  if (result.stats.hardRuleViolations) assert.match(result.warnings.join(' '), /Bestmögliche Zuteilung/i);
});

test('Berechnungsqualität führt die erwartete Zahl Varianten aus', () => {
  const data = createSampleData();
  data.settings.qualityMode = 'fast';
  const fast = optimizeEvent(data);
  assert.equal(fast.ok, true);
  assert.equal(fast.quality.runsTried, 1);

  data.settings.qualityMode = 'standard';
  const standard = optimizeEvent(data);
  assert.equal(standard.ok, true);
  assert.equal(standard.quality.runsTried, 6);
  assert.ok(standard.stats.first >= fast.stats.first);

  data.settings.qualityMode = 'thorough';
  const thorough = optimizeEvent(data);
  assert.equal(thorough.ok, true);
  assert.equal(thorough.quality.runsTried, 24);
  assert.ok(thorough.stats.first >= fast.stats.first);
});

test('Viertwunsch wird vermieden, wenn eine Lösung mit Drittwunsch möglich ist', () => {
  const event = {
    name: 'Wunschpriorität',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 10, balanceThreshold: 10, cohortMin: 0, qualityMode: 'standard', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'A', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0 },
      { id: 'B', offerId: 'B', name: 'B', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0 },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: 'A', className: '9a', schoolForm: 'Regional', wishes: ['A', 'X', 'Y', 'B'], fixed: '' },
      { id: 'P2', firstName: 'B', lastName: 'B', className: '9a', schoolForm: 'Regional', wishes: ['Z', 'A', 'B', ''], fixed: '' },
    ],
    locks: [],
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.fourth, 0);
  assert.equal(result.stats.third, 1);
});

test('Kleine Kurse erhalten bis zur Ausgleichsschwelle ihre Maximalgröße als Ziel', () => {
  const event = {
    name: 'Kleine Kurse',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 10, balanceThreshold: 5, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'S', offerId: 'S', name: 'Klein', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 5, mode: 'Pflicht', cohortMin: 0 },
      { id: 'L1', offerId: 'L1', name: 'Groß 1', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 20, mode: 'Pflicht', cohortMin: 0 },
      { id: 'L2', offerId: 'L2', name: 'Groß 2', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 20, mode: 'Pflicht', cohortMin: 0 },
    ],
    participants: Array.from({ length: 9 }, (_, i) => ({
      id: `P${i + 1}`, firstName: 'T', lastName: String(i + 1), className: '9a', schoolForm: 'Regional',
      wishes: ['S', 'L1', 'L2', ''], fixed: '',
    })),
    locks: [],
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  const targets = Object.fromEntries(result.courseResults.map((course) => [course.id, course.target]));
  assert.equal(targets.S, 5);
  assert.equal(targets.L1 + targets.L2, 4);
  assert.ok(targets.L1 <= 2 && targets.L2 <= 2);
});

test('Mehrere gleichzeitige harte Jahrgangsverletzungen werden nacheinander repariert', () => {
  const event = {
    name: 'Harte Regeln reparierbar',
    settings: {
      allowOutside: false,
      defaultMode: 'Pflicht',
      balanceWeight: 0,
      balanceThreshold: 10,
      cohortMin: 0,
      qualityMode: 'fast',
      rules: [{ id: 'R1', type: 'grade', min: 2, mode: 'hard', enabled: true }],
    },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Kurs A', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 4, mode: 'Pflicht', cohortMin: 0 },
      { id: 'B', offerId: 'B', name: 'Kurs B', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 3, mode: 'Pflicht', cohortMin: 0 },
      { id: 'C', offerId: 'C', name: 'Kurs C', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 3, mode: 'Pflicht', cohortMin: 0 },
    ],
    participants: [
      { id: 'A11', firstName: 'A', lastName: '11', className: '11a', schoolForm: 'Regional', wishes: ['A','B','',''], fixed: '' },
      { id: 'A10', firstName: 'A', lastName: '10', className: '10a', schoolForm: 'Regional', wishes: ['A','C','',''], fixed: '' },
      { id: 'B11-1', firstName: 'B', lastName: '1', className: '11b', schoolForm: 'Regional', wishes: ['B','A','',''], fixed: '' },
      { id: 'B11-2', firstName: 'B', lastName: '2', className: '11b', schoolForm: 'Regional', wishes: ['B','A','',''], fixed: '' },
      { id: 'B11-3', firstName: 'B', lastName: '3', className: '11b', schoolForm: 'Regional', wishes: ['B','A','',''], fixed: '' },
      { id: 'C10-1', firstName: 'C', lastName: '1', className: '10b', schoolForm: 'Regional', wishes: ['C','A','',''], fixed: '' },
      { id: 'C10-2', firstName: 'C', lastName: '2', className: '10b', schoolForm: 'Regional', wishes: ['C','A','',''], fixed: '' },
      { id: 'C10-3', firstName: 'C', lastName: '3', className: '10b', schoolForm: 'Regional', wishes: ['C','A','',''], fixed: '' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.hardRuleViolations, 0);
  const courseA = result.courseResults.find((course) => course.id === 'A');
  assert.equal(courseA.load, 4);
  assert.equal(courseA.ruleHardViolations, 0);
});

test('Kursbezogene Jahrgangs-Minima und -Maxima werden hart eingehalten', () => {
  const event = {
    name: 'Jahrgangsgrenzen',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 10, balanceThreshold: 10, cohortMin: 0, qualityMode: 'standard', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Kurs A', session: '', gradeFrom: 7, gradeTo: 10, schoolForm: 'Alle', min: 4, max: 6, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: 3, max: 3 }, '9': { min: null, max: 1 } } },
      { id: 'B', offerId: 'B', name: 'Kurs B', session: '', gradeFrom: 7, gradeTo: 10, schoolForm: 'Alle', min: 2, max: 8, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '8aG', schoolForm: 'Gymnasial', wishes: ['B','A','',''], fixed: '' },
      { id: 'P2', firstName: 'A', lastName: '2', className: '8bR', schoolForm: 'Regional', wishes: ['B','A','',''], fixed: '' },
      { id: 'P3', firstName: 'A', lastName: '3', className: '8cG', schoolForm: 'Gymnasial', wishes: ['A','B','',''], fixed: '' },
      { id: 'P4', firstName: 'B', lastName: '4', className: '9aG', schoolForm: 'Gymnasial', wishes: ['A','B','',''], fixed: '' },
      { id: 'P5', firstName: 'B', lastName: '5', className: '9bR', schoolForm: 'Regional', wishes: ['A','B','',''], fixed: '' },
      { id: 'P6', firstName: 'C', lastName: '6', className: '10aG', schoolForm: 'Gymnasial', wishes: ['A','B','',''], fixed: '' },
      { id: 'P7', firstName: 'C', lastName: '7', className: '10bR', schoolForm: 'Regional', wishes: ['B','A','',''], fixed: '' },
      { id: 'P8', firstName: 'C', lastName: '8', className: '7aG', schoolForm: 'Gymnasial', wishes: ['B','A','',''], fixed: '' },
    ], locks: []
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  const assignedA = result.participantResults.filter((row) => row.workshopId === 'A');
  const countGrade = (grade) => assignedA.filter((row) => String(row.className).startsWith(String(grade))).length;
  assert.equal(countGrade(8), 3);
  assert.ok(countGrade(9) <= 1);
  const courseA = result.courseResults.find((course) => course.id === 'A');
  assert.deepEqual(courseA.gradeLimitSummary.map((x) => [x.grade, x.min, x.max, x.count]), [[8,3,3,3],[9,null,1,countGrade(9)]]);
});

test('Leere Jahrgangsgrenzen erzeugen keine zusätzliche Vorgabe', () => {
  const event = {
    name: 'Leere Jahrgangsgrenzen',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'A', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 4, mode: 'Pflicht', cohortMin: 0, gradeLimits: { '8': { min: '', max: '' } } },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '9aR', schoolForm: 'Regional', wishes: ['A','','',''], fixed: '' },
    ], locks: []
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.deepEqual(result.event.workshops[0].gradeLimits, {});
});

test('Nicht exakt erfüllbares Jahrgangsminimum liefert eine bestmögliche Lösung mit Warnung', () => {
  const event = {
    name: 'Jahrgangsminimum unmöglich',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Drachenboot', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 5, mode: 'Pflicht', cohortMin: 0, gradeLimits: { '8': { min: 2, max: null } } },
      { id: 'B', offerId: 'B', name: 'Andere', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 5, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '8aG', schoolForm: 'Gymnasial', wishes: ['A','','',''], fixed: '' },
      { id: 'P2', firstName: 'B', lastName: '2', className: '9aR', schoolForm: 'Regional', wishes: ['B','','',''], fixed: '' },
      { id: 'P3', firstName: 'C', lastName: '3', className: '10aG', schoolForm: 'Gymnasial', wishes: ['B','','',''], fixed: '' },
    ], locks: []
  };
  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.gradeLimitDeviation, 1);
  assert.match(result.warnings.join(' '), /bestmögliche Zuteilung.*Jg\. 8.*mindestens 2/i);
});

test('Jahrgangsmaximum wird bei voll belegten Kursen durch Tauschaktionen erfüllt', () => {
  const participants = [
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `A8-${i + 1}`, firstName: 'Acht', lastName: String(i + 1), className: '8a',
      schoolForm: 'Regional', wishes: ['A', 'B', '', ''], fixed: '',
    })),
    { id: 'A9-1', firstName: 'Neun', lastName: '1', className: '9a', schoolForm: 'Regional', wishes: ['A', 'B', '', ''], fixed: '' },
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `B10-${i + 1}`, firstName: 'Zehn', lastName: String(i + 1), className: '10a',
      schoolForm: 'Regional', wishes: ['B', 'A', '', ''], fixed: '',
    })),
  ];
  const event = {
    name: 'Jahrgangsmaximum mit Tausch',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Social Media', session: '', gradeFrom: 8, gradeTo: 10, schoolForm: 'Alle', min: 12, max: 12, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: null, max: 8 } } },
      { id: 'B', offerId: 'B', name: 'Alternativkurs', session: '', gradeFrom: 8, gradeTo: 10, schoolForm: 'Alle', min: 4, max: 4, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
    ],
    participants,
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  const socialMedia = result.participantResults.filter((person) => person.workshopId === 'A');
  assert.equal(socialMedia.length, 12);
  assert.equal(socialMedia.filter((person) => String(person.className).startsWith('8')).length, 8);
  assert.equal(result.stats.unassigned, 0);
});

test('Jahrgangsmaximum verdrängt bei fehlendem Ausweichplatz niemanden aus dem Workshop', () => {
  const event = {
    name: 'Bestmöglich statt Nichtzuteilung',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Forscherwerkstatt', session: '', gradeFrom: 8, gradeTo: 10, schoolForm: 'Alle', min: 1, max: 12, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: null, max: 8 } } },
    ],
    participants: Array.from({ length: 11 }, (_, i) => ({
      id: `P${i + 1}`, firstName: 'Acht', lastName: String(i + 1), className: '8a',
      schoolForm: 'Regional', wishes: ['A', '', '', ''], fixed: '',
    })),
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.unassigned, 0);
  assert.equal(result.courseResults[0].load, 11);
  assert.equal(result.stats.gradeLimitDeviation, 3);
  assert.equal(result.stats.ruleViolationCount, 1);
  assert.match(result.warnings.join(' '), /Forscherwerkstatt.*Jg\. 8: 11 statt höchstens 8/i);
  assert.ok(result.participantResults.every((person) => /Zugeordnet mit Regelhinweis/.test(person.note)));
});

test('Globale Jahrgangssuche findet eine nur über drei Kurse lösbare Verschiebungskette', () => {
  const event = {
    name: 'Dreierzyklus für Jahrgangsmaximum',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Forscherwerkstatt', session: '', gradeFrom: 8, gradeTo: 9, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: null, max: 0 } } },
      { id: 'B', offerId: 'B', name: 'Medien', session: '', gradeFrom: 9, gradeTo: 10, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
      { id: 'C', offerId: 'C', name: 'Technik', session: '', gradeFrom: 8, gradeTo: 10, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
    ],
    participants: [
      { id: 'P8', firstName: 'Acht', lastName: 'A', className: '8a', schoolForm: 'Regional', wishes: ['A', 'C', '', ''], fixed: '' },
      { id: 'P9', firstName: 'Neun', lastName: 'B', className: '9a', schoolForm: 'Regional', wishes: ['B', 'A', '', ''], fixed: '' },
      { id: 'P10', firstName: 'Zehn', lastName: 'C', className: '10a', schoolForm: 'Regional', wishes: ['C', 'B', '', ''], fixed: '' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.participantResults.find((person) => person.personId === 'P9').workshopId, 'A');
  assert.equal(result.participantResults.find((person) => person.personId === 'P10').workshopId, 'B');
  assert.equal(result.participantResults.find((person) => person.personId === 'P8').workshopId, 'C');
  assert.equal(result.stats.unassigned, 0);
});

test('Unvermeidbare Jahrgangsabweichung liefert eine bestmögliche Lösung statt Abbruch', () => {
  const event = {
    name: 'Bestmöglicher Fallback',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Forscherwerkstatt', session: '', gradeFrom: 8, gradeTo: 8, schoolForm: 'Alle', min: 1, max: 1, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: null, max: 0 } } },
    ],
    participants: [
      { id: 'P8', firstName: 'Acht', lastName: 'A', className: '8a', schoolForm: 'Regional', wishes: ['A', '', '', ''], fixed: '' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.participantResults[0].workshopId, 'A');
  assert.equal(result.stats.gradeLimitDeviation, 1);
  assert.equal(result.stats.hardRuleViolations, 1);
  assert.equal(result.stats.ruleViolationCount, 1);
  assert.match(result.warnings.join(' '), /bestmögliche Zuteilung.*Jg\. 8/i);
});

test('Jahrgangsgruppen-Regel hält 8+9 und 10+ jeweils durch vier teilbar', () => {
  const participants = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `S${i + 1}`, firstName: 'Sek', lastName: `I${i + 1}`, className: i < 3 ? '8a' : '9a', schoolForm: 'Regional', wishes: ['D','X','',''], fixed: '' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `O${i + 1}`, firstName: 'Sek', lastName: `II${i + 1}`, className: `${10 + (i % 2)}a`, schoolForm: 'Gymnasial', wishes: ['D','X','',''], fixed: '' })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `X${i + 1}`, firstName: 'Andere', lastName: String(i + 1), className: i ? '10b' : '9b', schoolForm: i ? 'Gymnasial' : 'Regional', wishes: ['X','D','',''], fixed: '' })),
  ];
  const event = {
    name: 'Jahrgangsgruppen',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'standard', rules: [] },
    workshops: [
      { id: 'D', offerId: 'D', name: 'Gruppenworkshop', session: '', gradeFrom: 8, gradeTo: 12, schoolForm: 'Alle', min: 8, max: 12, mode: 'Pflicht', cohortMin: 0, gradeGroupRule: { enabled: true, balance: true } },
      { id: 'X', offerId: 'X', name: 'Alternativkurs', session: '', gradeFrom: 8, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 12, mode: 'Pflicht', cohortMin: 0 },
    ],
    participants,
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  const debate = result.courseResults.find((course) => course.id === 'D');
  assert.deepEqual(debate.gradeGroupSummary.map((item) => item.count % 4), [0, 0]);
  assert.equal(debate.ruleHardViolations, 0);
  assert.equal(result.stats.hardRuleViolations, 0);
  assert.equal(result.stats.gradeGroupImbalance, 0);
});

test('Nicht erfüllbare Jahrgangsgruppen-Regel behält alle Zuteilungen und warnt konkret', () => {
  const event = {
    name: 'Vierergruppe unmöglich',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'D', offerId: 'D', name: 'Gruppenworkshop', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 4, max: 4, mode: 'Pflicht', cohortMin: 0, gradeGroupRule: { enabled: true, balance: true } },
      { id: 'X', offerId: 'X', name: 'Alternativkurs', session: '', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 1, max: 4, mode: 'Pflicht', cohortMin: 0 },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '8a', schoolForm: 'Regional', wishes: ['D','','',''], fixed: 'D' },
      { id: 'P2', firstName: 'B', lastName: '2', className: '7a', schoolForm: 'Regional', wishes: ['D','','',''], fixed: 'D' },
      { id: 'P3', firstName: 'C', lastName: '3', className: '7b', schoolForm: 'Regional', wishes: ['D','','',''], fixed: 'D' },
      { id: 'P4', firstName: 'D', lastName: '4', className: '7c', schoolForm: 'Regional', wishes: ['D','','',''], fixed: 'D' },
      { id: 'P5', firstName: 'E', lastName: '5', className: '9a', schoolForm: 'Regional', wishes: ['X','','',''], fixed: 'X' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.unassigned, 0);
  assert.equal(result.stats.gradeGroupDeviation, 1);
  assert.equal(result.courseResults.find((course) => course.id === 'D').ruleDeviations, 1);
  assert.match(result.warnings.join(' '), /Bestmögliche Zuteilung.*Sek I.*Gruppengröße 4/i);
  assert.match(result.participantResults.find((person) => person.workshopId === 'D').note, /Zugeordnet mit Regelhinweis/i);
});

test('Alte Projekte werden auf die neutral benannte Jahrgangsgruppen-Regel migriert', () => {
  const normalized = normalizeEvent({
    workshops: [{ id: 'A', offerId: 'A', name: 'Alt', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 8, mode: 'Pflicht', debateRule: { enabled: true, balance: false } }],
    participants: [], locks: [], settings: {},
  });
  assert.deepEqual(normalized.workshops[0].gradeGroupRule, { enabled: true, balance: false });
  assert.equal(Object.hasOwn(normalized.workshops[0], 'debateRule'), false);
});

test('Projekte ohne Jahrgangsgruppen-Regel bleiben rückwärtskompatibel deaktiviert', () => {
  const normalized = normalizeEvent({
    workshops: [{ id: 'A', offerId: 'A', name: 'Alt', gradeFrom: 7, gradeTo: 12, schoolForm: 'Alle', min: 0, max: 8, mode: 'Pflicht' }],
    participants: [], locks: [], settings: {},
  });
  assert.deepEqual(normalized.workshops[0].gradeGroupRule, { enabled: false, balance: true });
});

test('Gewichtungsregler schützt bei 0 Prozent die Wünsche und bei 100 Prozent die Jahrgangsverteilung', () => {
  const base = {
    name: 'Zielkonflikt Wünsche und Jahrgänge',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', rules: [] },
    workshops: [
      { id: 'A', offerId: 'A', name: 'Kurs A', session: '', gradeFrom: 8, gradeTo: 9, schoolForm: 'Alle', min: 2, max: 2, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '8': { min: null, max: 1 } } },
      { id: 'B', offerId: 'B', name: 'Kurs B', session: '', gradeFrom: 8, gradeTo: 9, schoolForm: 'Alle', min: 2, max: 2, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '9': { min: null, max: 1 } } },
    ],
    participants: [
      { id: 'P8-1', firstName: 'Acht', lastName: '1', className: '8a', schoolForm: 'Regional', wishes: ['A', 'B', '', ''], fixed: '' },
      { id: 'P8-2', firstName: 'Acht', lastName: '2', className: '8b', schoolForm: 'Regional', wishes: ['A', 'B', '', ''], fixed: '' },
      { id: 'P9-1', firstName: 'Neun', lastName: '1', className: '9a', schoolForm: 'Regional', wishes: ['B', 'A', '', ''], fixed: '' },
      { id: 'P9-2', firstName: 'Neun', lastName: '2', className: '9b', schoolForm: 'Regional', wishes: ['B', 'A', '', ''], fixed: '' },
    ],
    locks: [],
  };

  const wishesFirst = optimizeEvent({ ...base, settings: { ...base.settings, gradePreferenceWeight: 0 } });
  const gradesFirst = optimizeEvent({ ...base, settings: { ...base.settings, gradePreferenceWeight: 100 } });

  assert.equal(wishesFirst.ok, true, wishesFirst.errors?.join('\n'));
  assert.equal(gradesFirst.ok, true, gradesFirst.errors?.join('\n'));
  assert.equal(wishesFirst.stats.unassigned, 0);
  assert.equal(gradesFirst.stats.unassigned, 0);
  assert.equal(wishesFirst.stats.first, 4);
  assert.equal(wishesFirst.stats.gradeLimitDeviation, 2);
  assert.equal(gradesFirst.stats.first, 2);
  assert.equal(gradesFirst.stats.second, 2);
  assert.equal(gradesFirst.stats.gradeLimitDeviation, 0);
});

test('Unerreichbares Jahrgangsminimum bricht die Zuteilung nicht vorzeitig ab', () => {
  const event = {
    name: 'Schülerfirma mit weichem Jahrgangsminimum',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', gradePreferenceWeight: 100, rules: [] },
    workshops: [
      { id: 'SF', offerId: 'SF', name: 'Schülerfirma', session: '', gradeFrom: 10, gradeTo: 10, schoolForm: 'Alle', min: 1, max: 4, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '10': { min: 4, max: null } } },
      { id: 'ALT', offerId: 'ALT', name: 'Alternative', session: '', gradeFrom: 10, gradeTo: 10, schoolForm: 'Alle', min: 1, max: 4, mode: 'Pflicht', cohortMin: 0, gradeLimits: {} },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '10a', schoolForm: 'Regional', wishes: ['SF', '', '', ''], fixed: '' },
      { id: 'P2', firstName: 'A', lastName: '2', className: '10a', schoolForm: 'Regional', wishes: ['SF', '', '', ''], fixed: '' },
      { id: 'P3', firstName: 'B', lastName: '3', className: '10b', schoolForm: 'Regional', wishes: ['ALT', '', '', ''], fixed: '' },
      { id: 'P4', firstName: 'B', lastName: '4', className: '10b', schoolForm: 'Regional', wishes: ['ALT', '', '', ''], fixed: '' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.stats.unassigned, 0);
  assert.equal(result.courseResults.find((course) => course.id === 'SF').load, 2);
  assert.equal(result.stats.gradeLimitDeviation, 2);
  assert.match(result.warnings.join(' '), /Schülerfirma.*Jg\. 10: 2 statt mindestens 4/i);
});

test('Nur die gesamte Kursmindestbelegung darf weiterhin blockieren', () => {
  const event = {
    name: 'Absolute Kursmindestbelegung',
    settings: { allowOutside: false, defaultMode: 'Pflicht', balanceWeight: 0, balanceThreshold: 10, cohortMin: 0, qualityMode: 'fast', gradePreferenceWeight: 100, rules: [] },
    workshops: [
      { id: 'SF', offerId: 'SF', name: 'Schülerfirma', session: '', gradeFrom: 10, gradeTo: 10, schoolForm: 'Alle', min: 4, max: 4, mode: 'Pflicht', cohortMin: 0,
        gradeLimits: { '10': { min: 4, max: null } } },
    ],
    participants: [
      { id: 'P1', firstName: 'A', lastName: '1', className: '10a', schoolForm: 'Regional', wishes: ['SF', '', '', ''], fixed: '' },
      { id: 'P2', firstName: 'A', lastName: '2', className: '10a', schoolForm: 'Regional', wishes: ['SF', '', '', ''], fixed: '' },
    ],
    locks: [],
  };

  const result = optimizeEvent(event);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Mindestbelegungen der Pflichtkurse/i);
  assert.doesNotMatch(result.errors.join(' '), /Jahrgang 10 benötigt/i);
});

test('Alte Projekte erhalten für den Gewichtungsregler die ausgewogene Standardstellung', () => {
  const normalized = normalizeEvent({ settings: {}, workshops: [], participants: [], locks: [] });
  assert.equal(normalized.settings.gradePreferenceWeight, 50);
  assert.equal(normalizeEvent({ settings: { gradePreferenceWeight: 0 }, workshops: [], participants: [], locks: [] }).settings.gradePreferenceWeight, 0);
  assert.equal(normalizeEvent({ settings: { gradePreferenceWeight: 150 }, workshops: [], participants: [], locks: [] }).settings.gradePreferenceWeight, 100);
});
