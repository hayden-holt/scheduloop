import assert from "node:assert/strict";
import fs from "node:fs";
import { getRotaMonth, moveRotaDate, readRotaView, summarizeRotaDay } from "../src/rota/monthlyRota.js";
import {
  getActiveHourWindow,
  generateTimeSlots,
  getActiveSlotWindow,
  getCoverageWindowFlags,
  getStaffingCoverageSlotWindow,
  getWeekdayFromDateKey,
  HOURS,
  isOpeningHoursValid,
  toLocalDateKey,
} from "../src/utils/schedule.js";
import {
  assertCsvFileIsSafe,
  parseCsv,
  parseCsvDemand,
} from "../src/utils/csvDemand.js";
import {
  calculateRoleStaff,
  applyMinimumTotalStaff,
  calculateBacktestSummary,
  normalizeStaffCount,
  runForecastBacktest,
  stabilizeStaffingRecommendations,
} from "../src/utils/staffing.js";
import {
  CSV_DEMAND_MODEL_VERSION,
  calculateForecastConfidence,
  getCsvBlendWeight,
  getCsvDemandUnitsForRole,
  getCsvTrustWeight,
  getDemandConfidence,
  isCurrentCsvDemandModel,
} from "../src/utils/demandModel.js";
import {
  getAverageFeedbackCorrection,
  getStaffingFeedback,
  saveStaffingFeedback,
} from "../src/utils/staffingFeedback.js";
import {
  calculateContextMultiplier,
  getActiveContextLabels,
  getContextAdjustmentSummary,
  getDefaultDayContext,
  hasActiveDayContext,
  normaliseDayConfigs,
  normaliseDayContext,
} from "../src/utils/dayContext.js";
import {
  detectDemandColumns,
  getDemandColumnForRole,
} from "../src/utils/roleDemand.js";
import {
  calculateLabourCostEstimate,
  normalizeHourlyWage,
} from "../src/utils/labourCost.js";
import {
  calculateRotaGuidance,
  formatSlotRange,
} from "../src/utils/rotaGuidance.js";
import {
  analyseCopyPreviousWeek,
  calculateCoverageForDay,
  calculateShiftIntervalContribution,
  calculateShiftDurationHours,
  calculateWeeklyRotaTotals,
  COVERAGE_STATUS,
  copyShiftsToWeek,
  formatCoverageValue,
  formatRotaSummaryText,
  getWeekDays,
  getWeekStartDateKey,
  hasOverlappingShift,
  validateShift,
} from "../src/utils/rota.js";
import {
  getFriendlyAuthErrorMessage,
  isValidEmail,
} from "../src/utils/authErrors.js";
import {
  applyBusinessRhythmToCurve,
  buildPeakStaffDefaults,
  deriveBusyLevelFromDemandEstimates,
  getDefaultRolesForBusinessProfile,
  getOpeningHoursForDate,
  normalizeBusinessProfileBasics,
  normalizeDemandEstimates,
  normalizeOpeningHours,
} from "../src/utils/businessProfileSetup.js";
import {
  buildCompletedOnboardingState,
  getWorkspaceRouteState,
  normalizeMembershipData,
  shouldLoadBusinessProfileForMembership,
} from "../src/business/businessProfileState.js";
import {
  canManageLegacyBusinessProfile,
  canManagePosIntegration,
} from "../functions/src/pos/authz.js";
import {
  createOAuthStateRecord,
  isOAuthStateRecordValid,
} from "../functions/src/pos/oauthState.js";
import {
  createSquareWebhookSignature,
  verifySquareWebhookSignature,
} from "../functions/src/pos/webhooks.js";
import { normalizeSquarePaymentToTransaction } from "../functions/src/pos/normaliseSquare.js";
import {
  buildIngestionDelta,
  calculateActualDemandSoFar,
  createPosDemandModelFromBuckets,
  getDemandBucketKey,
} from "../functions/src/pos/demandAggregation.js";
import {
  collectSquarePayments,
  createBackfillWindow,
} from "../functions/src/pos/squareClient.js";
import {
  FORECAST_DEMAND_SOURCES,
  getForecastDemandModel,
} from "../src/integrations/pos/demandSources.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function hasUnsupportedNestedArray(value) {
  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some(
      (item) => Array.isArray(item) || hasUnsupportedNestedArray(item)
    );
  }

  return Object.values(value).some(hasUnsupportedNestedArray);
}

test("opening hours must close after they open", () => {
  assert.equal(
    isOpeningHoursValid({ open: "09:00", close: "17:00" }),
    true
  );
  assert.equal(
    isOpeningHoursValid({ open: "17:00", close: "09:00" }),
    false
  );
  assert.equal(
    isOpeningHoursValid({ open: "09:00", close: "09:00" }),
    false
  );
});

test("active hour window slices expected hours", () => {
  const window = getActiveHourWindow({ open: "09:00", close: "12:00" });
  assert.deepEqual(window.activeHours, ["09:00", "10:00", "11:00", "12:00"]);
  assert.equal(window.start, 4);
  assert.equal(window.end, 7);
  assert.equal(window.isValid, true);
});

test("active slot window supports 30 minute blocks", () => {
  const window = getActiveSlotWindow(
    { open: "09:00", close: "10:00" },
    { intervalMinutes: 30 }
  );
  assert.deepEqual(window.slotLabels, ["09:00", "09:30"]);
  assert.equal(window.intervalMinutes, 30);
});

test("active slot window stays trading-hours only with prep and close cover", () => {
  const window = getActiveSlotWindow(
    { open: "09:00", close: "14:00" },
    { intervalMinutes: 30, prepMinutes: 30, closeMinutes: 30 }
  );

  assert.deepEqual(window.slotLabels, [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
  ]);
});

test("staffing coverage window includes prep and clean-up slots", () => {
  const window = getStaffingCoverageSlotWindow(
    { open: "09:00", close: "14:00" },
    { intervalMinutes: 30, prepMinutes: 30, closeMinutes: 30 }
  );

  assert.deepEqual(window.slotLabels, [
    "08:30",
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
  ]);
  assert.deepEqual(window.tradingSlotLabels, [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
  ]);
  assert.deepEqual(
    getCoverageWindowFlags(0, window.slotLabels.length, {
      intervalMinutes: 30,
      prepMinutes: 30,
      closeMinutes: 30,
    }),
    { isPrepWindow: true, isCloseWindow: false }
  );
  assert.deepEqual(
    getCoverageWindowFlags(window.slotLabels.length - 1, window.slotLabels.length, {
      intervalMinutes: 30,
      prepMinutes: 30,
      closeMinutes: 30,
    }),
    { isPrepWindow: false, isCloseWindow: true }
  );
});

test("time slot generation supports 15 minute blocks", () => {
  assert.deepEqual(generateTimeSlots("09:00", "09:30", 15), [
    "09:00",
    "09:15",
  ]);
});

test("invalid active hour window falls back without crashing", () => {
  const window = getActiveHourWindow({ open: "18:00", close: "09:00" });
  assert.deepEqual(window.activeHours, HOURS);
  assert.equal(window.isValid, false);
});

test("local date keys do not use UTC conversion", () => {
  const date = new Date(2026, 0, 2, 1, 30);
  assert.equal(toLocalDateKey(date), "2026-01-02");
});

test("weekday is calculated from local date key", () => {
  assert.equal(getWeekdayFromDateKey("2026-01-02"), 5);
});

test("business profile basics normalize older and partial profiles", () => {
  assert.deepEqual(normalizeBusinessProfileBasics({ businessType: "cafe" }), {
    businessName: "My business",
    businessType: "cafe",
    businessSubtype: "coffeeShop",
    location: "",
    customerPattern: "steady",
    businessRhythm: "notSure",
  });

  assert.equal(
    normalizeBusinessProfileBasics({
      businessType: "not-valid",
      businessSubtype: "not-valid",
      customerPattern: "morningRush",
    }).businessSubtype,
    "commercialGym"
  );
});

test("demand estimates keep skipped values optional", () => {
  const estimates = normalizeDemandEstimates(
    { unit: "covers", quiet: "", normal: "120", busy: "220" },
    "cafe"
  );

  assert.deepEqual(estimates, {
    unit: "covers",
    quiet: null,
    normal: 120,
    busy: 220,
  });
  assert.equal(deriveBusyLevelFromDemandEstimates(estimates, "normal"), "busy");
  assert.deepEqual(normalizeDemandEstimates({}, "gym"), {
    unit: "checkIns",
    quiet: null,
    normal: null,
    busy: null,
  });
});

test("business rhythm applies a conservative curve adjustment", () => {
  const baseCurve = Array(HOURS.length).fill(1);
  const lunchCurve = applyBusinessRhythmToCurve(baseCurve, "lunch");
  const normalCurve = applyBusinessRhythmToCurve(baseCurve, "notSure");

  assert.equal(normalCurve[HOURS.indexOf("12:00")], 1);
  assert.equal(lunchCurve[HOURS.indexOf("12:00")], 1.18);
  assert.equal(lunchCurve[HOURS.indexOf("08:00")], 1);
});

test("opening hours support optional weekend differences", () => {
  const hours = normalizeOpeningHours({
    open: "06:00",
    close: "18:00",
    weekend: {
      enabled: true,
      open: "08:00",
      close: "16:00",
    },
  });

  assert.deepEqual(getOpeningHoursForDate(hours, "2026-01-02"), {
    open: "06:00",
    close: "18:00",
  });
  assert.deepEqual(getOpeningHoursForDate(hours, "2026-01-03"), {
    open: "08:00",
    close: "16:00",
  });
  assert.equal(
    isOpeningHoursValid({ open: hours.weekend.close, close: hours.weekend.open }),
    false
  );
});

test("role defaults change safely by business type and subtype", () => {
  const fullServiceRoles = getDefaultRolesForBusinessProfile({
    businessType: "cafe",
    businessSubtype: "fullServiceRestaurant",
  });
  const takeawayRoles = getDefaultRolesForBusinessProfile({
    businessType: "cafe",
    businessSubtype: "takeaway",
  });
  const commercialGymRoles = getDefaultRolesForBusinessProfile({
    businessType: "gym",
    businessSubtype: "commercialGym",
  });

  assert.equal(
    fullServiceRoles.some((role) => role.id === "manager"),
    true
  );
  assert.equal(
    takeawayRoles.find((role) => role.id === "wait").requiredDuringOpen,
    false
  );
  assert.equal(
    commercialGymRoles.some((role) => role.id === "cleanerFloor"),
    true
  );
  assert.equal(fullServiceRoles[0].curve.length, HOURS.length);
  assert.deepEqual(buildPeakStaffDefaults(fullServiceRoles), {
    barista: 2,
    kitchen: 3,
    wait: 4,
    manager: 1,
  });
});

test("CSV parser supports quoted commas", () => {
  const rows = parseCsv('timestamp,note\n"2026-01-02T09:15:00","hello, world"');
  assert.deepEqual(rows, [
    ["timestamp", "note"],
    ["2026-01-02T09:15:00", "hello, world"],
  ]);
});

test("CSV demand reports skipped rows", () => {
  const csv = [
    "timestamp,note",
    "2026-01-02T09:15:00,one",
    "2026-01-02T09:45:00,two",
    "bad timestamp,bad",
    "2026-01-02T23:15:00,outside",
  ].join("\n");

  const demand = parseCsvDemand(csv, {
    now: () => new Date("2026-01-02T12:00:00Z"),
  });

  assert.equal(demand.rows, 2);
  assert.equal(demand.totalRows, 4);
  assert.equal(demand.skippedRows, 2);
  assert.equal(demand.invalidRows[0].reason, "Invalid timestamp");
  assert.equal(demand.fallback[demand.slotLabels.indexOf("09:00")], 1);
});

test("CSV demand uses weighted demand columns and actual staff", () => {
  const csv = [
    "timestamp,orders,staff_count",
    "2026-01-02T09:15:00,10,2",
    "2026-01-02T09:45:00,20,3",
  ].join("\n");

  const demand = parseCsvDemand(csv, {
    openingHours: { open: "09:00", close: "10:00" },
    intervalMinutes: 30,
    now: () => new Date("2026-01-02T12:00:00Z"),
  });

  assert.equal(demand.rows, 2);
  assert.equal(demand.demandMetric.column, "orders");
  assert.deepEqual(demand.slotLabels, ["09:00", "09:30"]);
  assert.equal(demand.fallbackUnits[0], 10);
  assert.equal(demand.fallbackUnits[1], 20);
  assert.equal(demand.actualStaffRows, 2);
  assert.equal(demand.actualStaffFallback[0], 2);
  assert.equal(demand.actualStaffFallback[1], 3);
});

test("CSV demand detects role-specific columns", () => {
  const headers = [
    "timestamp",
    "drink_orders",
    "food_orders",
    "customers",
    "staff",
  ];
  const detected = detectDemandColumns(headers);

  assert.equal(detected.hasRoleSpecificDemand, true);
  assert.equal(
    getDemandColumnForRole({ id: "barista", name: "Barista" }, detected).key,
    "drinkOrders"
  );
  assert.equal(
    getDemandColumnForRole({ id: "kitchen", name: "Kitchen" }, detected).key,
    "foodOrders"
  );
  assert.equal(
    getDemandColumnForRole({ id: "wait", name: "Wait Staff" }, detected).key,
    "customers"
  );
});

test("CSV demand stores role-specific demand curves", () => {
  const csv = [
    "timestamp,drink_orders,food_orders,customers,staff",
    "2026-01-02T09:00:00,10,4,12,2",
    "2026-01-02T09:30:00,20,8,18,3",
  ].join("\n");

  const demand = parseCsvDemand(csv, {
    openingHours: { open: "09:00", close: "10:00" },
    intervalMinutes: 30,
    now: () => new Date("2026-01-02T12:00:00Z"),
  });

  assert.equal(demand.hasRoleSpecificDemand, true);
  assert.equal(demand.demandSources.drinkOrders.fallbackUnits[0], 10);
  assert.equal(
    getCsvDemandUnitsForRole({
      csvDemand: demand,
      role: { id: "barista", name: "Barista" },
      weekday: 5,
      slotIndex: 1,
      useWeekdayData: true,
    }),
    20
  );
});

test("CSV demand averages units by observed business day", () => {
  const csv = [
    "timestamp,orders,staff_count",
    "2026-01-02T09:05:00,5,2",
    "2026-01-02T09:10:00,5,4",
    "2026-01-09T09:05:00,20,6",
  ].join("\n");

  const demand = parseCsvDemand(csv, {
    openingHours: { open: "09:00", close: "09:30" },
    intervalMinutes: 30,
    now: () => new Date("2026-01-10T12:00:00Z"),
  });

  assert.equal(demand.observedDays, 2);
  assert.equal(demand.modelVersion, CSV_DEMAND_MODEL_VERSION);
  assert.equal(Array.isArray(demand.byWeekday), false);
  assert.equal(demand.weekdaySampleCounts[5], 2);
  assert.equal(demand.fallbackUnits[0], 15);
  assert.equal(demand.byWeekdayUnits[5][0], 15);
  assert.equal(demand.actualStaffFallback[0], 4.5);
  assert.equal(demand.actualStaffByWeekday[5][0], 4.5);
});

test("CSV demand model is safe to store in Firestore", () => {
  const csv = [
    "timestamp,orders,staff_count",
    "2026-01-02T09:00:00,10,2",
    "2026-01-09T09:00:00,20,3",
  ].join("\n");

  const demand = parseCsvDemand(csv, {
    openingHours: { open: "09:00", close: "09:30" },
    intervalMinutes: 30,
    now: () => new Date("2026-01-10T12:00:00Z"),
  });

  assert.equal(hasUnsupportedNestedArray(demand), false);
});

test("stale CSV demand models are rejected", () => {
  assert.equal(isCurrentCsvDemandModel({ rows: 10 }), false);
  assert.equal(
    isCurrentCsvDemandModel({ rows: 10, modelVersion: CSV_DEMAND_MODEL_VERSION }),
    true
  );
});

test("CSV demand rejects files without timestamp columns", () => {
  assert.throws(
    () => parseCsvDemand("name,count\nAlice,1"),
    /Could not find/
  );
});

test("CSV file safety rejects non-CSV files", () => {
  assert.doesNotThrow(() =>
    assertCsvFileIsSafe({ name: "demand.csv", type: "text/csv", size: 128 })
  );
  assert.throws(
    () => assertCsvFileIsSafe({ name: "demand.txt", type: "text/plain", size: 128 }),
    /CSV file/
  );
  assert.throws(
    () => assertCsvFileIsSafe({ name: "demand.csv", type: "application/json", size: 128 }),
    /plain CSV/
  );
});

test("CSV demand rejects duplicate headers and formula-like cells", () => {
  assert.throws(
    () =>
      parseCsvDemand("timestamp,timestamp\n2026-01-02T09:00:00,2026-01-02T09:00:00"),
    /duplicate header/
  );
  assert.throws(
    () => parseCsvDemand("timestamp,orders\n2026-01-02T09:00:00,=SUM(A1:A2)"),
    /formula-like/
  );
});

test("CSV demand rejects files with no usable rows", () => {
  assert.throws(
    () => parseCsvDemand("timestamp\n2026-01-02T23:15:00"),
    /No valid rows matched/
  );
});

const role = {
  id: "barista",
  curve: [1, 2, 4, 2],
};

test("staff count normalization rejects invalid and negative counts", () => {
  assert.equal(normalizeStaffCount(""), 0);
  assert.equal(normalizeStaffCount("-2"), 0);
  assert.equal(normalizeStaffCount("2.4"), 2);
});

test("staffing returns zero for near-zero demand", () => {
  assert.equal(
    calculateRoleStaff({ demand: 0, role, absoluteIndex: 2, peak: 4 }),
    0
  );
});

test("staffing caps staffing at peak", () => {
  assert.equal(
    calculateRoleStaff({ demand: 1.5, role, absoluteIndex: 2, peak: 3 }),
    3
  );
});

test("staffing uses service rate for weighted CSV demand", () => {
  assert.equal(
    calculateRoleStaff({
      demand: 1,
      demandUnits: 90,
      role: { ...role, serviceRate: 30, demandWeight: 1 },
      absoluteIndex: 2,
      peak: 5,
      intervalMinutes: 60,
      operatingRules: { demandBufferPercent: 0, breakAllowancePercent: 0 },
    }),
    3
  );
});

test("staffing handles missing peak with role curve fallback", () => {
  assert.equal(
    calculateRoleStaff({ demand: 0.75, role, absoluteIndex: 2, peak: 0 }),
    3
  );
});

test("role shaping differentiates common roles without randomness", () => {
  const flatCurve = Array(HOURS.length).fill(1);
  const morningIndex = HOURS.indexOf("09:00");
  const baristaMorning = calculateRoleStaff({
    demand: 0.7,
    role: { id: "barista", name: "Barista", curve: flatCurve },
    absoluteIndex: morningIndex,
    peak: 5,
  });
  const repeatBaristaMorning = calculateRoleStaff({
    demand: 0.7,
    role: { id: "barista", name: "Barista", curve: flatCurve },
    absoluteIndex: morningIndex,
    peak: 5,
  });
  const waitMorning = calculateRoleStaff({
    demand: 0.7,
    role: { id: "wait", name: "Wait Staff", curve: flatCurve },
    absoluteIndex: morningIndex,
    peak: 5,
  });

  assert.equal(baristaMorning, repeatBaristaMorning);
  assert.equal(baristaMorning, 4);
  assert.equal(waitMorning, 3);
});

test("minimum total staff fills a required role", () => {
  const adjusted = applyMinimumTotalStaff(
    { hour: "09:00", barista: 1, total: 1 },
    [{ id: "barista", requiredDuringOpen: true }],
    2
  );
  assert.equal(adjusted.barista, 2);
  assert.equal(adjusted.total, 2);
});

test("staffing recommendations remove isolated short spikes", () => {
  const points = [
    { hour: "09:00", coveragePhase: "trading", barista: 1, total: 1 },
    { hour: "10:00", coveragePhase: "trading", barista: 2, total: 2 },
    { hour: "11:00", coveragePhase: "trading", barista: 1, total: 1 },
    { hour: "12:00", coveragePhase: "trading", barista: 1, total: 1 },
  ];
  const stable = stabilizeStaffingRecommendations(
    points,
    [{ id: "barista", maxStaff: 4 }],
    { intervalMinutes: 60 }
  );

  assert.deepEqual(
    stable.map((point) => point.barista),
    [1, 1, 1, 1]
  );
  assert.deepEqual(
    stable.map((point) => point.total),
    [1, 1, 1, 1]
  );
});

test("staffing recommendations bridge one-slot dips into stable blocks", () => {
  const points = [
    { hour: "09:00", coveragePhase: "trading", barista: 1, total: 1 },
    { hour: "10:00", coveragePhase: "trading", barista: 2, total: 2 },
    { hour: "11:00", coveragePhase: "trading", barista: 1, total: 1 },
    { hour: "12:00", coveragePhase: "trading", barista: 2, total: 2 },
    { hour: "13:00", coveragePhase: "trading", barista: 1, total: 1 },
  ];
  const stable = stabilizeStaffingRecommendations(
    points,
    [{ id: "barista", maxStaff: 4 }],
    { intervalMinutes: 60 }
  );

  assert.deepEqual(
    stable.map((point) => point.barista),
    [1, 2, 2, 2, 1]
  );
  assert.deepEqual(
    stable.map((point) => point.total),
    [1, 2, 2, 2, 1]
  );
});

test("staffing stability keeps prep and clean-up cover separate", () => {
  const points = [
    { hour: "08:30", coveragePhase: "prep", barista: 1, total: 1 },
    { hour: "09:00", coveragePhase: "trading", barista: 3, total: 3 },
    { hour: "10:00", coveragePhase: "trading", barista: 3, total: 3 },
    { hour: "11:00", coveragePhase: "close", barista: 1, total: 1 },
  ];
  const stable = stabilizeStaffingRecommendations(
    points,
    [{ id: "barista", maxStaff: 4 }],
    { intervalMinutes: 60 }
  );

  assert.deepEqual(
    stable.map((point) => point.barista),
    [1, 3, 3, 1]
  );
});

test("May 2026 cafe sample can be stabilized deterministically", () => {
  const csv = fs.readFileSync(
    new URL("../sample-data/cafe-rich-role-demand.csv", import.meta.url),
    "utf8"
  );
  const model = parseCsvDemand(csv, {
    openingHours: { open: "08:00", close: "17:00" },
    intervalMinutes: 30,
  });
  const friday = model.actualStaffByWeekday[5] || [];
  const points = model.slotLabels.map((hour, index) => ({
    hour,
    coveragePhase: "trading",
    floor: friday[index] || 0,
    total: friday[index] || 0,
  }));
  const roles = [{ id: "floor", maxStaff: 10 }];
  const stable = stabilizeStaffingRecommendations(points, roles, {
    intervalMinutes: model.intervalMinutes,
  });
  const repeatStable = stabilizeStaffingRecommendations(points, roles, {
    intervalMinutes: model.intervalMinutes,
  });

  assert.deepEqual(stable, repeatStable);
  assert.equal(Math.max(...stable.map((point) => point.total)), 6);
  assert.deepEqual(
    stable.map((point) => point.total).slice(7, 11),
    [6, 6, 6, 6]
  );
});

test("day context defaults and invalid values stay safe", () => {
  const defaultContext = getDefaultDayContext();
  assert.equal(hasActiveDayContext(defaultContext), false);
  assert.equal(calculateContextMultiplier(defaultContext), 1);

  const context = normaliseDayContext({
    promotion: "yes",
    payday: true,
    weather: {
      enabled: true,
      condition: "hail",
      temperatureC: "not a number",
    },
  });

  assert.equal(context.promotion, false);
  assert.equal(context.payday, true);
  assert.equal(context.weather.condition, "normal");
  assert.equal(context.weather.temperatureC, null);
  assert.equal(hasActiveDayContext(context), true);
});

test("day context multipliers compound and clamp", () => {
  assert.equal(
    calculateContextMultiplier({
      payday: true,
      localEvent: true,
    }),
    1.296
  );

  assert.equal(
    calculateContextMultiplier({
      promotion: true,
      localEvent: true,
      sportEvent: true,
      payday: true,
      bankHoliday: true,
      weather: { enabled: true, condition: "hot" },
    }),
    1.5
  );
});

test("day context summaries explain active assumptions", () => {
  const summary = getContextAdjustmentSummary({
    roadworks: true,
    weather: { enabled: true, condition: "rain" },
  });

  assert.equal(summary.multiplier, 0.855);
  assert.equal(summary.percentChange, -15);
  assert.deepEqual(summary.labels, ["Roadworks nearby: -10%", "Rain: -5%"]);
  assert.deepEqual(getActiveContextLabels({ bankHoliday: true }), [
    "Bank holiday",
  ]);
});

test("day config normalization preserves old day type-only entries", () => {
  const configs = normaliseDayConfigs({
    "2026-05-01": { dayType: "busy" },
    "2026-05-02": { dayType: "event", context: { payday: true } },
  });

  assert.equal(configs["2026-05-01"].dayType, "busy");
  assert.equal("context" in configs["2026-05-01"], false);
  assert.equal(configs["2026-05-02"].context.payday, true);
});

test("backtest summary compares predictions with actual staff", () => {
  const summary = calculateBacktestSummary(
    [
      { hour: "09:00", total: 2 },
      { hour: "09:30", total: 4 },
    ],
    {
      slotLabels: ["09:00", "09:30"],
      actualStaffFallback: [3, 3],
      actualStaffByWeekday: Array.from({ length: 7 }, () => [null, null]),
    },
    5
  );

  assert.equal(summary.blocksCompared, 2);
  assert.equal(summary.meanAbsoluteError, 1);
  assert.equal(summary.underStaffedBlocks, 1);
  assert.equal(summary.overStaffedBlocks, 1);
});

test("manager feedback stores and averages corrections", () => {
  const feedback = saveStaffingFeedback([null], {
    date: "2026-01-02",
    hour: "09:00",
    roleId: "barista",
    predictedStaff: 2,
    actualStaff: 3,
    feedback: "understaffed",
  });

  assert.equal(feedback.length, 1);
  assert.equal(
    getAverageFeedbackCorrection({
      weekday: 5,
      hour: "09:00",
      roleId: "barista",
      feedbackEntries: feedback,
    }),
    1
  );

  const neutralFeedback = saveStaffingFeedback(feedback, {
    date: "2026-01-09",
    hour: "09:00",
    roleId: "barista",
    predictedStaff: 2,
    actualStaff: 2,
    feedback: "right",
  });

  assert.equal(getStaffingFeedback({ staffingFeedback: [null] }).length, 0);
  assert.equal(
    getAverageFeedbackCorrection({
      weekday: 5,
      hour: "09:00",
      roleId: "barista",
      feedbackEntries: [null, ...neutralFeedback, { date: "not-a-date" }],
    }),
    0.5
  );
});

test("forecast backtest returns a safe accuracy summary", () => {
  const dailyDemandByDate = {};

  for (let day = 1; day <= 8; day += 1) {
    const date = `2026-01-${String(day).padStart(2, "0")}`;
    dailyDemandByDate[date] = {
      weekday: new Date(`${date}T12:00:00`).getDay(),
      demandUnits: day === 8 ? [Number.NaN, 20 + day] : [10 + day, 20 + day],
      actualStaff: day === 8 ? [Number.NaN, 2] : [1, 2],
    };
  }

  const result = runForecastBacktest({
    historicalData: {
      slotLabels: ["09:00", "09:30"],
      intervalMinutes: 30,
      dailyDemandByDate,
    },
    roles: [
      {
        id: "barista",
        name: "Barista",
        curve: [1, 1],
        serviceRate: 20,
        minStaff: 1,
        demandWeight: 1,
        requiredDuringOpen: true,
      },
    ],
    businessProfile: { peakStaff: { barista: 3 } },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.sampleSize, 8);
});

test("CSV blend weight trusts stronger weekday samples more", () => {
  assert.equal(
    getCsvBlendWeight({
      hasCsv: true,
      hasWeekdayData: true,
      weekdaySampleCount: 6,
      observedDays: 20,
      totalRows: 100,
    }),
    0.65
  );
  assert.equal(
    getCsvBlendWeight({
      hasCsv: true,
      hasWeekdayData: true,
      weekdaySampleCount: 1,
      observedDays: 20,
      totalRows: 100,
    }),
    0.5
  );
  assert.equal(
    getCsvBlendWeight({
      hasCsv: true,
      hasWeekdayData: false,
      weekdaySampleCount: 0,
      observedDays: 7,
      totalRows: 100,
    }),
    0.35
  );
  assert.equal(
    getCsvTrustWeight({
      usableCsvDays: 90,
      weekdaySampleSize: 8,
      totalRows: 1000,
      hasWeekdayData: true,
    }),
    0.9
  );
});

test("demand confidence labels weak and strong uploaded data", () => {
  assert.equal(getDemandConfidence(null, 5).label, "Low");
  assert.equal(
    getDemandConfidence({ rows: 20, observedDays: 3, weekdaySampleCounts: [] }, 5)
      .label,
    "Low"
  );
  assert.equal(
    getDemandConfidence(
      {
        rows: 100,
        observedDays: 30,
        weekdaySampleCounts: [0, 0, 0, 0, 0, 6],
        hasRoleSpecificDemand: true,
      },
      5
    ).label,
    "High"
  );
  assert.equal(
    calculateForecastConfidence({
      usableCsvDays: 30,
      weekdaySampleSize: 6,
      hasRoleSpecificDemand: true,
      hasStaffHistory: true,
      hasManagerFeedback: true,
      hasDayContext: true,
    }).level,
    "High"
  );
});

test("rota guidance identifies peak and quiet cover windows", () => {
  const guidance = calculateRotaGuidance({
    chartData: [
      { hour: "09:00", total: 1, barista: 1, kitchen: 0 },
      { hour: "09:30", total: 2, barista: 1, kitchen: 1 },
      { hour: "10:00", total: 5, barista: 3, kitchen: 2 },
      { hour: "10:30", total: 5, barista: 3, kitchen: 2 },
      { hour: "11:00", total: 2, barista: 1, kitchen: 1 },
    ],
    roles: [
      { id: "barista", name: "Barista" },
      { id: "kitchen", name: "Kitchen" },
    ],
    intervalMinutes: 30,
    minTotalStaff: 1,
  });

  assert.equal(guidance.strongestCoverLabel, "10:00-11:00");
  assert.equal(guidance.quietCoverLabel, "09:00-10:00");
  assert.equal(
    guidance.roleAdvice.includes(
      "Barista demand peaks at 3 staff around 10:00-11:00."
    ),
    true
  );
  assert.equal(guidance.warnings.length, 1);
});

test("slot range formatting includes the final forecast block", () => {
  assert.equal(formatSlotRange("12:00", "13:30", 30), "12:00-14:00");
});

test("shift duration subtracts unpaid breaks", () => {
  assert.equal(
    calculateShiftDurationHours({
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: 30,
    }),
    7.5
  );
});

test("shift validation prevents overlap and impossible breaks", () => {
  const employees = [{ id: "maya", displayName: "Maya" }];
  const shifts = [
    {
      id: "shift-1",
      employeeId: "maya",
      date: "2026-08-10",
      startTime: "09:00",
      endTime: "13:00",
      roleId: "barista",
      breakMinutes: 0,
    },
  ];
  const overlappingShift = {
    employeeId: "maya",
    date: "2026-08-10",
    startTime: "12:00",
    endTime: "15:00",
    roleId: "barista",
    breakMinutes: 0,
  };
  const result = validateShift(overlappingShift, { employees, shifts });
  const breakResult = validateShift(
    {
      employeeId: "maya",
      date: "2026-08-10",
      startTime: "09:00",
      endTime: "10:00",
      roleId: "barista",
      breakMinutes: 60,
    },
    { employees, shifts: [] }
  );

  assert.equal(hasOverlappingShift(overlappingShift, shifts), true);
  assert.equal(result.isValid, false);
  assert.equal(result.errors.overlap, "This overlaps another shift for the same employee.");
  assert.equal(breakResult.isValid, false);
  assert.equal(breakResult.errors.breakMinutes, "Break must be shorter than the shift.");
});

test("weekly rota totals calculate hours and available cost", () => {
  const weekStart = getWeekStartDateKey("2026-08-12");
  const weekDays = getWeekDays(weekStart);
  const totals = calculateWeeklyRotaTotals({
    weekDays,
    employees: [{ id: "maya", displayName: "Maya", hourlyRate: 12 }],
    roles: [{ id: "barista", hourlyWage: null }],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "13:00",
        roleId: "barista",
        breakMinutes: 0,
      },
      {
        employeeId: "maya",
        date: "2026-08-11",
        startTime: "10:00",
        endTime: "14:00",
        roleId: "barista",
        breakMinutes: 30,
      },
    ],
  });

  assert.equal(totals.weeklyHours, 7.5);
  assert.equal(totals.employeeHours.maya, 7.5);
  assert.equal(totals.dailyHours["2026-08-11"], 3.5);
  assert.equal(totals.weeklyCost, 90);
});

test("coverage compares recommended and scheduled staffing", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [
      { hour: "09:00", total: 2, barista: 1, kitchen: 1 },
      { hour: "10:00", total: 3, barista: 2, kitchen: 1 },
    ],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "11:00",
        roleId: "barista",
      },
      {
        employeeId: "sam",
        date: "2026-08-10",
        startTime: "10:00",
        endTime: "11:00",
        roleId: "kitchen",
      },
    ],
    roles: [
      { id: "barista", name: "Barista" },
      { id: "kitchen", name: "Kitchen" },
    ],
    intervalMinutes: 60,
  });

  assert.equal(rows[0].status, "under");
  assert.equal(rows[0].scheduledTotal, 1);
  assert.equal(rows[1].status, "under");
  assert.equal(rows[1].roleCoverage[0].difference, -1);
});

test("coverage counts partial interval overlap proportionally", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [{ hour: "09:00", total: 1, barista: 1 }],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:30",
        endTime: "10:00",
        roleId: "barista",
      },
    ],
    roles: [{ id: "barista", name: "Barista" }],
    intervalMinutes: 60,
  });

  assert.equal(
    calculateShiftIntervalContribution(
      { startTime: "09:15", endTime: "09:45" },
      9 * 60,
      10 * 60
    ),
    0.5
  );
  assert.equal(rows[0].scheduledTotal, 0.5);
  assert.equal(rows[0].difference, -0.5);
  assert.equal(rows[0].status, COVERAGE_STATUS.under);
});

test("coverage combines partial shifts and respects adjacent boundaries", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [
      { hour: "09:00", total: 1, floor: 1 },
      { hour: "10:00", total: 1, floor: 1 },
    ],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "09:30",
        roleId: "floor",
      },
      {
        employeeId: "sam",
        date: "2026-08-10",
        startTime: "09:30",
        endTime: "10:00",
        roleId: "floor",
      },
      {
        employeeId: "nia",
        date: "2026-08-10",
        startTime: "11:00",
        endTime: "12:00",
        roleId: "floor",
      },
    ],
    roles: [{ id: "floor", name: "Floor" }],
    intervalMinutes: 60,
  });

  assert.equal(rows[0].scheduledTotal, 1);
  assert.equal(rows[0].status, COVERAGE_STATUS.matched);
  assert.equal(rows[1].scheduledTotal, 0);
  assert.equal(rows[1].status, COVERAGE_STATUS.under);
});

test("coverage handles shifts spanning multiple shorter intervals", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [
      { hour: "09:00", total: 1, floor: 1 },
      { hour: "09:30", total: 1, floor: 1 },
      { hour: "10:00", total: 1, floor: 1 },
      { hour: "10:30", total: 1, floor: 1 },
    ],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:15",
        endTime: "10:45",
        roleId: "floor",
      },
    ],
    roles: [{ id: "floor", name: "Floor" }],
    intervalMinutes: 30,
  });

  assert.deepEqual(
    rows.map((row) => row.scheduledTotal),
    [0.5, 1, 1, 0.5]
  );
});

test("coverage flags role mismatch when total cover matches but roles are wrong", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [{ hour: "12:00", total: 2, barista: 1, kitchen: 1 }],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "12:00",
        endTime: "13:00",
        roleId: "barista",
      },
      {
        employeeId: "sam",
        date: "2026-08-10",
        startTime: "12:00",
        endTime: "13:00",
        roleId: "barista",
      },
    ],
    roles: [
      { id: "barista", name: "Barista" },
      { id: "kitchen", name: "Kitchen" },
    ],
    intervalMinutes: 60,
  });

  assert.equal(rows[0].scheduledTotal, 2);
  assert.equal(rows[0].difference, 0);
  assert.equal(rows[0].status, COVERAGE_STATUS.roleMismatch);
  assert.equal(rows[0].roleCoverage[0].difference, 1);
  assert.equal(rows[0].roleCoverage[1].difference, -1);
});

test("coverage formatting and tolerance avoid floating point noise", () => {
  const rows = calculateCoverageForDay({
    forecastPoints: [{ hour: "09:00", total: 1.005, floor: 1.005 }],
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "10:00",
        roleId: "floor",
      },
    ],
    roles: [{ id: "floor", name: "Floor" }],
    intervalMinutes: 60,
  });

  assert.equal(formatCoverageValue(1), "1");
  assert.equal(formatCoverageValue(1.5), "1.5");
  assert.equal(formatCoverageValue(2.25), "2.25");
  assert.equal(rows[0].difference, 0);
  assert.equal(rows[0].status, COVERAGE_STATUS.matched);
});

test("copy previous week shifts keeps details and moves dates", () => {
  const copied = copyShiftsToWeek(
    [
      {
        id: "old-shift",
        employeeId: "maya",
        date: "2026-08-03",
        startTime: "09:00",
        endTime: "13:00",
        roleId: "barista",
        breakMinutes: 15,
      },
    ],
    "2026-08-10"
  );

  assert.equal(copied[0].id, undefined);
  assert.equal(copied[0].date, "2026-08-10");
  assert.equal(copied[0].employeeId, "maya");
  assert.equal(copied[0].breakMinutes, 15);
});

test("copy previous week analysis detects duplicates, overlaps, inactive and missing employees", () => {
  const previousShifts = [
    {
      id: "previous-duplicate",
      employeeId: "maya",
      date: "2026-08-03",
      startTime: "09:00",
      endTime: "13:00",
      roleId: "barista",
      breakMinutes: 15,
    },
    {
      id: "previous-adjacent",
      employeeId: "maya",
      date: "2026-08-03",
      startTime: "13:00",
      endTime: "14:00",
      roleId: "barista",
      breakMinutes: 0,
    },
    {
      id: "previous-overlap",
      employeeId: "maya",
      date: "2026-08-04",
      startTime: "11:00",
      endTime: "15:00",
      roleId: "kitchen",
      breakMinutes: 0,
    },
    {
      id: "previous-inactive",
      employeeId: "sam",
      date: "2026-08-05",
      startTime: "09:00",
      endTime: "10:00",
      roleId: "barista",
      breakMinutes: 0,
    },
    {
      id: "previous-missing",
      employeeId: "missing",
      date: "2026-08-06",
      startTime: "09:00",
      endTime: "10:00",
      roleId: "barista",
      breakMinutes: 0,
    },
  ];
  const analysis = analyseCopyPreviousWeek({
    previousShifts,
    targetWeekStartKey: "2026-08-10",
    targetShifts: [
      {
        id: "current-duplicate",
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "13:00",
        roleId: "barista",
        breakMinutes: 15,
      },
      {
        id: "current-overlap",
        employeeId: "maya",
        date: "2026-08-11",
        startTime: "10:00",
        endTime: "12:00",
        roleId: "barista",
        breakMinutes: 0,
      },
    ],
    employees: [
      { id: "maya", displayName: "Maya", active: true },
      { id: "sam", displayName: "Sam", active: false },
    ],
  });

  assert.equal(analysis.summary.totalPrevious, 5);
  assert.equal(analysis.summary.existingTargetShifts, 2);
  assert.equal(analysis.summary.safe, 1);
  assert.equal(analysis.summary.exactDuplicates, 1);
  assert.equal(analysis.summary.overlaps, 1);
  assert.equal(analysis.summary.inactiveEmployees, 1);
  assert.equal(analysis.summary.missingEmployees, 1);
  assert.equal(analysis.safeShifts[0].startTime, "13:00");
  assert.equal(analysis.safeShifts[0].date, "2026-08-10");
});

test("copy previous week analysis catches overlaps between copied shifts", () => {
  const analysis = analyseCopyPreviousWeek({
    previousShifts: [
      {
        employeeId: "maya",
        date: "2026-08-03",
        startTime: "09:00",
        endTime: "11:00",
        roleId: "barista",
      },
      {
        employeeId: "maya",
        date: "2026-08-03",
        startTime: "10:30",
        endTime: "12:00",
        roleId: "barista",
      },
    ],
    targetWeekStartKey: "2026-08-10",
    targetShifts: [],
    employees: [{ id: "maya", displayName: "Maya", active: true }],
  });

  assert.equal(analysis.summary.safe, 1);
  assert.equal(analysis.summary.overlaps, 1);
  assert.equal(analysis.skippedShifts[0].issues.includes("proposedOverlap"), true);
});

test("employee-facing rota summary groups shifts without private cost details", () => {
  const weekStart = getWeekStartDateKey("2026-08-12");
  const summary = formatRotaSummaryText({
    businessName: "Loop Cafe",
    location: "Leeds",
    weekStart,
    status: "published",
    shifts: [
      {
        employeeId: "maya",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "13:00",
        roleId: "barista",
        breakMinutes: 15,
      },
    ],
    employees: [{ id: "maya", displayName: "Maya", hourlyRate: 14 }],
    roles: [{ id: "barista", name: "Barista", hourlyWage: 12 }],
  });

  assert.equal(summary.includes("Loop Cafe - Leeds"), true);
  assert.equal(summary.includes("Status: Published"), true);
  assert.equal(summary.includes("Maya"), true);
  assert.equal(summary.includes("- Maya: 09:00-13:00, Barista, 15 min break"), true);
  assert.equal(summary.includes("14"), false);
  assert.equal(summary.toLowerCase().includes("forecast"), false);
  assert.equal(summary.includes("£"), false);
});

test("labour cost is hidden when wages are missing", () => {
  const estimate = calculateLabourCostEstimate({
    chartData: [{ hour: "09:00", total: 2, barista: 2 }],
    roles: [{ id: "barista", name: "Barista" }],
    intervalMinutes: 60,
  });

  assert.equal(estimate.hasWage, false);
  assert.equal(estimate.estimatedCost, null);
  assert.equal(estimate.totalStaffHours, 2);
});

test("labour cost uses average wage as a safe default", () => {
  const estimate = calculateLabourCostEstimate({
    chartData: [
      { hour: "09:00", total: 2, barista: 2 },
      { hour: "10:00", total: 3, barista: 3 },
    ],
    roles: [{ id: "barista", name: "Barista" }],
    intervalMinutes: 60,
    averageHourlyWage: 10,
  });

  assert.equal(estimate.hasWage, true);
  assert.equal(estimate.estimatedCost, 50);
  assert.equal(estimate.coveredStaffHours, 5);
});

test("labour cost can mix role wages with a fallback wage", () => {
  const estimate = calculateLabourCostEstimate({
    chartData: [{ hour: "09:00", total: 3, barista: 2, kitchen: 1 }],
    roles: [
      { id: "barista", name: "Barista", hourlyWage: 12 },
      { id: "kitchen", name: "Kitchen" },
    ],
    intervalMinutes: 60,
    averageHourlyWage: 10,
  });

  assert.equal(estimate.estimatedCost, 34);
  assert.equal(estimate.rolesWithWages, 1);
});

test("hourly wage normalization treats blank and invalid values as missing", () => {
  assert.equal(normalizeHourlyWage(""), null);
  assert.equal(normalizeHourlyWage("-1"), null);
  assert.equal(normalizeHourlyWage("10.555"), 10.56);
});

test("auth helpers return friendly messages and validate email links", () => {
  assert.equal(isValidEmail("owner@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(
    getFriendlyAuthErrorMessage({ code: "auth/expired-action-code" }),
    "This sign-in link has expired. Request a new secure link."
  );
  assert.equal(
    getFriendlyAuthErrorMessage({ code: "auth/invalid-action-code" }),
    "This sign-in link is not valid. Request a new secure link."
  );
});

test("auth route state sends unauthenticated users to login", () => {
  assert.equal(getWorkspaceRouteState({ isAuthenticated: false }), "login");
});

test("membership route state denies missing and inactive memberships", () => {
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      accessDenied: true,
    }),
    "accessDenied"
  );
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: normalizeMembershipData({
        status: "inactive",
        role: "owner",
        businessId: "biz-1",
        onboardingComplete: true,
      }),
    }),
    "accessDenied"
  );
});

test("first-time authorised memberships route to onboarding", () => {
  const noBusinessIdField = normalizeMembershipData({
    status: "active",
    role: "owner",
    onboardingComplete: false,
  });

  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: normalizeMembershipData({
        status: "active",
        role: "owner",
        businessId: null,
        onboardingComplete: false,
      }),
    }),
    "onboarding"
  );
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: noBusinessIdField,
    }),
    "onboarding"
  );
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: normalizeMembershipData({
        status: "active",
        role: "owner",
        businessId: "manually-added-before-onboarding",
      }),
    }),
    "onboarding"
  );
  assert.equal(shouldLoadBusinessProfileForMembership(noBusinessIdField), false);
});

test("legacy memberships only load a business profile for compatibility", () => {
  const legacyMembership = normalizeMembershipData({
    status: "active",
    role: "owner",
    businessId: "legacy-business-id",
  });
  const explicitIncompleteMembership = normalizeMembershipData({
    status: "active",
    role: "owner",
    businessId: "not-onboarded-yet",
    onboardingComplete: false,
  });

  assert.equal(legacyMembership.legacyProvisioned, true);
  assert.equal(shouldLoadBusinessProfileForMembership(legacyMembership), true);
  assert.equal(
    shouldLoadBusinessProfileForMembership(explicitIncompleteMembership),
    false
  );
});

test("onboarding completion links a generated business to the membership", () => {
  const { profile, membership } = buildCompletedOnboardingState({
    businessId: "generated-business-id",
    user: { uid: "user-1", email: "owner@example.com" },
    membership: normalizeMembershipData({
      email: "owner@example.com",
      role: "owner",
      status: "active",
      businessId: null,
      onboardingComplete: false,
    }),
    config: {
      businessName: "Hayden Cafe",
      businessType: "cafe",
      roles: [{ id: "barista" }],
      hours: { open: "09:00", close: "17:00" },
    },
  });

  assert.equal(profile.businessId, "generated-business-id");
  assert.equal(profile.ownerUid, "user-1");
  assert.equal(membership.businessId, "generated-business-id");
  assert.equal(membership.onboardingComplete, true);
  assert.equal(membership.needsOnboarding, false);
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership,
      profile,
    }),
    "dashboard"
  );
});

test("returning authorised users with a valid business route to dashboard", () => {
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: normalizeMembershipData({
        status: "active",
        role: "manager",
        businessId: "biz-1",
        onboardingComplete: true,
      }),
      profile: {
        businessId: "biz-1",
        businessType: "cafe",
        roles: [{ id: "barista" }],
        hours: { open: "09:00", close: "17:00" },
      },
    }),
    "dashboard"
  );
});

test("provisioned account profile read failures stay real errors", () => {
  assert.equal(
    getWorkspaceRouteState({
      isAuthenticated: true,
      membership: normalizeMembershipData({
        status: "active",
        role: "owner",
        businessId: "biz-1",
        onboardingComplete: true,
      }),
      profileError: "Profile could not load",
    }),
    "profileError"
  );
});

test("POS integration management is tenant and role scoped", () => {
  assert.equal(
    canManagePosIntegration(
      { businessId: "biz-a", status: "active", role: "manager" },
      "biz-a"
    ),
    true
  );
  assert.equal(
    canManagePosIntegration(
      { businessId: "biz-a", status: "active", role: "manager" },
      "biz-b"
    ),
    false
  );
  assert.equal(
    canManagePosIntegration(
      { businessId: "biz-a", status: "active", role: "employee" },
      "biz-a"
    ),
    false
  );
  assert.equal(
    canManageLegacyBusinessProfile({
      uid: "legacy-owner",
      businessId: "legacy-owner",
      profile: { ownerUid: "legacy-owner" },
    }),
    true
  );
});

test("Square OAuth state validates owner, expiry and one-time use", () => {
  const now = new Date("2026-01-01T09:00:00Z");
  const { state, stateHash, record } = createOAuthStateRecord({
    uid: "user-1",
    businessId: "biz-1",
    now,
  });

  assert.equal(state.length > 20, true);
  assert.match(stateHash, /^[a-f0-9]{64}$/);
  assert.equal(
    isOAuthStateRecordValid(record, {
      uid: "user-1",
      now: new Date("2026-01-01T09:05:00Z"),
    }),
    true
  );
  assert.equal(
    isOAuthStateRecordValid(
      {
        ...record,
        expiresAt: {
          toDate: () => new Date("2026-01-01T09:10:00Z"),
        },
      },
      {
        uid: "user-1",
        now: new Date("2026-01-01T09:05:00Z"),
      }
    ),
    true
  );
  assert.equal(
    isOAuthStateRecordValid(record, {
      uid: "other-user",
      now: new Date("2026-01-01T09:05:00Z"),
    }),
    false
  );
  assert.equal(
    isOAuthStateRecordValid(record, {
      uid: "user-1",
      now: new Date("2026-01-01T09:11:00Z"),
    }),
    false
  );
  assert.equal(
    isOAuthStateRecordValid(
      { ...record, consumedAt: now.toISOString() },
      {
        uid: "user-1",
        now,
      }
    ),
    false
  );
});

test("Square webhook signatures reject tampered payloads", () => {
  const notificationUrl = "https://example.com/squareWebhook";
  const rawBody = Buffer.from(JSON.stringify({ merchant_id: "merchant-1" }));
  const signatureKey = "sandbox-signature-key";
  const signatureHeader = createSquareWebhookSignature({
    notificationUrl,
    rawBody,
    signatureKey,
  });

  assert.equal(
    verifySquareWebhookSignature({
      notificationUrl,
      rawBody,
      signatureKey,
      signatureHeader,
    }),
    true
  );
  assert.equal(
    verifySquareWebhookSignature({
      notificationUrl,
      rawBody: Buffer.from(JSON.stringify({ merchant_id: "merchant-2" })),
      signatureKey,
      signatureHeader,
    }),
    false
  );
});

test("Square payments normalise to minimal ScheduleLoop transactions", () => {
  const transaction = normalizeSquarePaymentToTransaction({
    businessId: "biz-1",
    scheduleLoopLocationId: "front-counter",
    squareMerchantId: "merchant-1",
    payment: {
      id: "pay-1",
      order_id: "order-1",
      merchant_id: "merchant-1",
      location_id: "loc-1",
      status: "COMPLETED",
      created_at: "2026-01-02T09:15:00Z",
      updated_at: "2026-01-02T09:16:00Z",
      total_money: { amount: 1250, currency: "GBP" },
      refunded_money: { amount: 250, currency: "GBP" },
      customer_id: "not-copied",
    },
  });

  assert.equal(transaction.businessId, "biz-1");
  assert.equal(transaction.source, "square");
  assert.equal(transaction.externalTransactionId, "pay-1");
  assert.equal(transaction.locationId, "front-counter");
  assert.equal(transaction.transactionCount, 1);
  assert.equal(transaction.revenue, 10);
  assert.equal("customer_id" in transaction, false);
});

test("POS demand buckets aggregate into the existing forecast model shape", () => {
  const bucket = getDemandBucketKey({
    timestamp: "2026-01-02T09:45:00",
    openingHours: { open: "09:00", close: "10:00" },
    intervalMinutes: 30,
  });
  const model = createPosDemandModelFromBuckets({
    openingHours: { open: "09:00", close: "10:00" },
    intervalMinutes: 30,
    now: () => new Date("2026-01-03T12:00:00Z"),
    buckets: [
      {
        source: "square",
        dateKey: "2026-01-02",
        weekday: 5,
        slotLabel: "09:00",
        transactionCount: 2,
      },
      {
        source: "square",
        dateKey: "2026-01-02",
        weekday: 5,
        slotLabel: "09:30",
        transactionCount: 4,
      },
    ],
  });

  assert.equal(bucket.slotLabel, "09:30");
  assert.equal(model.modelVersion, CSV_DEMAND_MODEL_VERSION);
  assert.deepEqual(model.slotLabels, ["09:00", "09:30"]);
  assert.deepEqual(model.fallbackUnits, [2, 4]);
  assert.deepEqual(model.byWeekdayUnits[5], [2, 4]);
  assert.equal(model.demandMetric.column, "Square transactions");
  assert.equal(hasUnsupportedNestedArray(model), false);
});

test("POS ingestion deltas reconcile updates and cancellations", () => {
  assert.deepEqual(
    buildIngestionDelta(
      { transactionCount: 1, revenue: 12.5, itemCount: 0 },
      { transactionCount: 1, revenue: 10, itemCount: 0 }
    ),
    { transactionCount: 0, revenue: -2.5, itemCount: 0 }
  );
  assert.deepEqual(
    buildIngestionDelta(
      { transactionCount: 1, revenue: 12.5, itemCount: 0 },
      null
    ),
    { transactionCount: -1, revenue: -12.5, itemCount: 0 }
  );
});

test("Square backfill paginates and clamps historical range", async () => {
  const calls = [];
  const result = await collectSquarePayments({
    beginTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-02T00:00:00Z",
    locationId: "loc-1",
    fetchPage: async ({ cursor }) => {
      calls.push(cursor || "first");
      return cursor
        ? { payments: [{ id: "pay-2" }] }
        : { payments: [{ id: "pay-1" }], cursor: "next-page" };
    },
  });
  const window = createBackfillWindow({
    days: 999,
    now: new Date("2026-01-31T00:00:00Z"),
  });

  assert.deepEqual(calls, ["first", "next-page"]);
  assert.deepEqual(result.payments.map((payment) => payment.id), [
    "pay-1",
    "pay-2",
  ]);
  assert.equal(window.days, 90);
});

test("live actuals compare POS buckets with forecast units without changing rota", () => {
  const actuals = calculateActualDemandSoFar({
    dateKey: "2026-01-02",
    upToTime: "09:30",
    forecastPoints: [
      { hour: "09:00", demandUnits: 10 },
      { hour: "09:30", demandUnits: 10 },
    ],
    buckets: [
      { dateKey: "2026-01-02", slotLabel: "09:00", transactionCount: 12 },
      { dateKey: "2026-01-02", slotLabel: "09:30", transactionCount: 18 },
      { dateKey: "2026-01-02", slotLabel: "10:00", transactionCount: 100 },
    ],
  });

  assert.deepEqual(actuals, {
    actualTransactions: 30,
    forecastTransactions: 20,
    variancePercent: 50,
  });
});

test("forecast demand source prefers CSV over overlapping Square history", () => {
  const csvDemand = { modelVersion: CSV_DEMAND_MODEL_VERSION, rows: 10 };
  const posDemand = {
    modelVersion: CSV_DEMAND_MODEL_VERSION,
    rows: 30,
    source: "square",
  };

  assert.equal(
    getForecastDemandModel({ csvDemand, posDemand }).source,
    FORECAST_DEMAND_SOURCES.CSV
  );
  assert.equal(
    getForecastDemandModel({ posDemand }).source,
    FORECAST_DEMAND_SOURCES.SQUARE
  );
  assert.equal(
    getForecastDemandModel({}).source,
    FORECAST_DEMAND_SOURCES.PRESET
  );
});

test("Firestore rules keep business data membership-gated", () => {
  const rules = fs.readFileSync(
    new URL("../firestore.rules", import.meta.url),
    "utf8"
  );

  assert.match(rules, /match \/memberships\/\{userId\}/);
  assert.match(rules, /allow read: if signedIn\(\) && request\.auth\.uid == userId;/);
  assert.match(rules, /membership\(\)\.businessId == businessId/);
  assert.match(rules, /membership\(\)\.onboardingComplete == true/);
  assert.match(rules, /function hasLegacyMembership\(businessId\)/);
  assert.match(rules, /!\('onboardingComplete' in membership\(\)\)/);
  assert.match(rules, /request\.resource\.data\.businessId == businessId/);
  assert.match(rules, /allow update: if canCompleteOwnMembershipOnboarding\(userId\);/);
  assert.match(rules, /allow create, delete: if false;/);
  assert.match(rules, /membershipBusinessIdMissing\(membership\(\)\)/);
  assert.match(rules, /membershipBusinessIdMissing\(resource\.data\)/);
  assert.match(rules, /getAfter\(membershipPath\(\)\)\.data\.businessId == businessId/);
  assert.match(
    rules,
    /onboardingBusinessAfterValid\(request\.resource\.data\.businessId\)/
  );
  assert.match(rules, /getAfter\(businessProfilePath\(businessId\)\)\.data\.ownerUid == request\.auth\.uid/);
  assert.match(rules, /profileCreatePayloadValid\(businessId\)/);
  assert.match(rules, /profileUpdatePayloadValid\(businessId\)/);
  assert.match(rules, /profileOwnerUnchangedOrBackfilled\(\)/);
  assert.doesNotMatch(rules, /request\.time\s*<\s*timestamp\.date/);
  assert.doesNotMatch(rules, /allow\s+read,\s*write:\s*if\s+true/);
  assert.doesNotMatch(
    rules,
    /allow\s+read,\s*write:\s*if\s+request\.auth\s*!=\s*null/
  );
});

test("Firestore rules cover current ScheduleLoop data paths", () => {
  const rules = fs.readFileSync(
    new URL("../firestore.rules", import.meta.url),
    "utf8"
  );
  const requiredMatches = [
    /match \/businessProfiles\/\{businessId\}/,
    /match \/employees\/\{employeeId\}/,
    /match \/shifts\/\{shiftId\}/,
    /match \/rotaWeeks\/\{weekStart\}/,
    /match \/posConnections\/\{provider\}/,
    /match \/demandBuckets\/\{bucketId\}/,
    /match \/posTransactions\/\{transactionId\}/,
    /match \/posSecrets\/\{secretId\}/,
    /match \/posMerchantMappings\/\{mappingId\}/,
    /match \/posWebhookEvents\/\{eventId\}/,
    /match \/squareOAuthStates\/\{stateId\}/,
    /match \/\{document=\*\*\}/,
  ];

  requiredMatches.forEach((pattern) => assert.match(rules, pattern));
});

test("Firestore rules deny client-side POS transaction injection", () => {
  const rules = fs.readFileSync(
    new URL("../firestore.rules", import.meta.url),
    "utf8"
  );

  assert.match(rules, /match \/posConnections\/\{provider\}/);
  assert.match(rules, /match \/demandBuckets\/\{bucketId\}/);
  assert.match(rules, /match \/posTransactions\/\{transactionId\}/);
  assert.match(rules, /match \/posSecrets\/\{secretId\}/);
  assert.match(rules, /match \/posWebhookEvents\/\{eventId\}/);
  assert.match(rules, /allow create, update, delete: if false;/);
  assert.match(rules, /allow read, write: if false;/);
  assert.doesNotMatch(rules, /posTransactions[\s\S]*allow create: if signedIn/);
});

test("rota calendar covers leap years, all month lengths and Monday-first offsets", () => {
  for (const [key, length, offset] of [
    ["2026-02-14", 28, 6], ["2024-02-29", 29, 3],
    ["2026-04-15", 30, 2], ["2026-10-14", 31, 3],
  ]) {
    const month = getRotaMonth(key);
    assert.equal(month.days.length, length);
    assert.equal(month.leadingDays, offset);
    assert.equal(month.days[0].dateKey, key.slice(0, 7) + "-01");
    assert.equal(month.days.at(-1).dateKey, key.slice(0, 7) + "-" + length);
    assert.equal(new Set(month.days.map((day) => day.dateKey)).size, length);
  }
  const offsets = new Set(Array.from({ length: 12 }, (_, index) =>
    getRotaMonth(`2026-${String(index + 1).padStart(2, "0")}-01`).leadingDays
  ));
  assert.equal(offsets.size, 7);
  assert.equal(getRotaMonth("2026-12-31").end, "2027-01-01");
});

test("rota navigation clamps month ends and crosses years and DST in local dates", () => {
  assert.equal(moveRotaDate("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(moveRotaDate("2024-01-31", "month", 1), "2024-02-29");
  assert.equal(moveRotaDate("2026-03-31", "month", -1), "2026-02-28");
  assert.equal(moveRotaDate("2026-12-14", "month", 1), "2027-01-14");
  assert.equal(moveRotaDate("2027-01-14", "month", -1), "2026-12-14");
  assert.equal(moveRotaDate("2026-03-25", "week", 1), "2026-04-01");
  assert.equal(moveRotaDate("2026-10-28", "week", -1), "2026-10-21");
  assert.equal(getWeekStartDateKey("2026-10-14"), "2026-10-12");
  assert.equal(getRotaMonth("2026-11-01").start, "2026-11-01");
  assert.equal(getWeekStartDateKey("2026-11-01"), "2026-10-26");
});

test("rota preference safely defaults to week and accepts only saved month", () => {
  for (const value of [null, "week", "invalid"]) {
    assert.equal(readRotaView({ getItem: () => value }), "week");
  }
  assert.equal(readRotaView({ getItem: () => "month" }), "month");
  assert.equal(readRotaView({ getItem: () => { throw new Error("blocked"); } }), "week");
  assert.equal(readRotaView(), "week");
});

test("monthly summaries preserve shifts and use existing wages, breaks and distinct staff", () => {
  const shifts = [
    { employeeId: "a", roleId: "floor", date: "2026-10-14", startTime: "09:00", endTime: "13:00", breakMinutes: 30 },
    { employeeId: "a", roleId: "floor", date: "2026-10-14", startTime: "14:00", endTime: "16:00", breakMinutes: 0 },
    { employeeId: "b", roleId: "floor", date: "2026-10-14", startTime: "09:00", endTime: "17:00", breakMinutes: 60 },
  ];
  const employees = [{ id: "a", hourlyRate: 12 }, { id: "b", active: false }];
  const roles = [{ id: "floor", hourlyWage: 10 }];
  const before = JSON.stringify({ shifts, employees, roles });
  const summary = summarizeRotaDay({ shifts, employees, roles, averageHourlyWage: 9 });
  assert.deepEqual(summary, { staffCount: 2, shiftCount: 3, labourCost: 136 });
  assert.equal(summary.labourCost, calculateWeeklyRotaTotals({ shifts, employees, roles, averageHourlyWage: 9 }).weeklyCost);
  assert.equal(JSON.stringify({ shifts, employees, roles }), before);
  assert.equal(summarizeRotaDay({ shifts, employees, roles: [], averageHourlyWage: 9 }).labourCost, 129);
  assert.equal(summarizeRotaDay({ shifts, employees, roles: [] }).labourCost, null);
  assert.deepEqual(summarizeRotaDay({}), { staffCount: 0, shiftCount: 0, labourCost: 0 });
  const busy = Array.from({ length: 100 }, (_, i) => ({ ...shifts[0], employeeId: String(i % 20) }));
  assert.deepEqual(summarizeRotaDay({ shifts: busy, roles }), { staffCount: 20, shiftCount: 100, labourCost: 3500 });
});

let failed = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`${tests.length} tests passed`);
}
