import {
  getCoverageWindowFlags,
  getHourIndexForSlot,
  getStaffingCoverageSlotWindow,
  getWeekdayFromDateKey,
  HOURS,
} from "./schedule.js";
import {
  applyMinimumTotalStaff,
  calculateRoleStaff,
  normalizeStaffCount,
  stabilizeStaffingRecommendations,
} from "./staffing.js";
import {
  getCsvBlendWeight,
  getCsvDemandUnitsForRole,
} from "./demandModel.js";
import {
  calculateContextMultiplier,
  normaliseDayContext,
} from "./dayContext.js";
import {
  getAverageFeedbackCorrection,
  TOTAL_FEEDBACK_ROLE_ID,
} from "./staffingFeedback.js";

export const DAY_TYPE_SCALE = {
  quiet: 0.8,
  normal: 1.0,
  busy: 1.2,
  event: 1.4,
};

export const BUSY_SCALE = {
  quiet: 0.7,
  normal: 1.0,
  busy: 1.3,
  veryBusy: 1.6,
};

export function buildPresetShape(roles = []) {
  const totals = Array(HOURS.length).fill(0);

  roles.forEach((role) => {
    (role.curve || []).forEach((value, index) => {
      const num = Number(value);
      if (Number.isFinite(num) && index < totals.length) {
        totals[index] += num;
      }
    });
  });

  const max = Math.max(...totals);
  if (!max || max <= 0) {
    return totals.map(() => 0);
  }

  return totals.map((total) => total / max);
}

function applyTotalFeedbackCorrection(point, roles, peakStaff, correction) {
  const adjustment = Number.isFinite(Number(correction))
    ? Math.round(Number(correction))
    : 0;

  if (adjustment === 0 || roles.length === 0) return point;

  const targetRole = roles.find((role) => role.requiredDuringOpen) || roles[0];
  const currentValue = normalizeStaffCount(point[targetRole.id]);
  const minStaff = normalizeStaffCount(targetRole.minStaff);
  const maxStaff =
    normalizeStaffCount(targetRole.maxStaff) ||
    normalizeStaffCount(peakStaff?.[targetRole.id]) ||
    Math.max(minStaff, 5);
  const nextValue = Math.max(
    minStaff,
    Math.min(Math.max(maxStaff, minStaff), currentValue + adjustment)
  );
  const difference = nextValue - currentValue;

  if (difference === 0) return point;

  return {
    ...point,
    [targetRole.id]: nextValue,
    total: Math.max(0, (point.total || 0) + difference),
  };
}

export function buildForecastChartData({
  roles = [],
  peakStaff = {},
  openingHours,
  operatingRules = {},
  selectedDate,
  dayConfigs = {},
  busyLevel = "normal",
  hasCsv = false,
  csvCurves = null,
  presetShape,
  staffingFeedback = [],
} = {}) {
  const selectedWeekday = getWeekdayFromDateKey(selectedDate);
  const activeDayContext = normaliseDayContext(
    dayConfigs[selectedDate]?.context
  );
  const activeContextMultiplier =
    calculateContextMultiplier(activeDayContext);
  const weekdaySampleCount =
    csvCurves?.weekdaySampleCounts?.[selectedWeekday] || 0;
  const observedDays = csvCurves?.observedDays || 0;
  const { slotLabels, tradingSlotLabels, intervalMinutes } =
    getStaffingCoverageSlotWindow(openingHours, operatingRules);
  const tradingSlotSet = new Set(tradingSlotLabels);
  const csvSlotIndexByLabel = new Map(
    (csvCurves?.slotLabels || []).map((label, index) => [label, index])
  );
  const weekdayCurve = csvCurves?.byWeekday?.[selectedWeekday] || null;
  const weekdayUnits = csvCurves?.byWeekdayUnits?.[selectedWeekday] || null;
  const hasWeekdayData =
    weekdaySampleCount > 0 &&
    weekdayCurve &&
    weekdayCurve.some((value) => (value || 0) > 0);
  const csvWeight = getCsvBlendWeight({
    hasCsv,
    hasWeekdayData,
    weekdaySampleCount,
    observedDays,
    totalRows: csvCurves?.rows || 0,
  });
  const safePresetShape = presetShape || buildPresetShape(roles);
  const dayType = dayConfigs[selectedDate]?.dayType || "normal";
  const dayScale = DAY_TYPE_SCALE[dayType] ?? 1.0;
  const busyScale = hasCsv ? 1 : BUSY_SCALE[busyLevel] ?? 1.0;

  const rawStaffingPoints = slotLabels.map((slotLabel, slotIndex) => {
    const absoluteIndex = getHourIndexForSlot(slotLabel);
    const point = { hour: slotLabel };
    const isTradingSlot = tradingSlotSet.has(slotLabel);
    const preset = isTradingSlot ? safePresetShape[absoluteIndex] ?? 0 : 0;
    const csvSlotIndex =
      isTradingSlot && csvCurves?.slotLabels
        ? csvSlotIndexByLabel.get(slotLabel) ?? -1
        : -1;
    const csvDemand =
      isTradingSlot && hasCsv && csvSlotIndex !== -1
        ? (hasWeekdayData
            ? weekdayCurve?.[csvSlotIndex]
            : csvCurves?.fallback?.[csvSlotIndex]) ?? 0
        : null;
    const demandUnits =
      isTradingSlot && hasCsv && csvSlotIndex !== -1
        ? (hasWeekdayData
            ? weekdayUnits?.[csvSlotIndex]
            : csvCurves?.fallbackUnits?.[csvSlotIndex]) ?? null
        : null;
    const baseDemand =
      isTradingSlot && csvDemand !== null
        ? csvWeight * csvDemand + (1 - csvWeight) * preset
        : preset;
    const demand = Math.min(
      Math.max(baseDemand * busyScale * dayScale * activeContextMultiplier, 0),
      1.5
    );
    const adjustedDemandUnits =
      demandUnits !== null
        ? Math.max(0, demandUnits * activeContextMultiplier)
        : demandUnits;
    const coverageFlags = getCoverageWindowFlags(
      slotIndex,
      slotLabels.length,
      operatingRules
    );
    const forceMinimum =
      coverageFlags.isPrepWindow || coverageFlags.isCloseWindow;
    point.demandScore = demand;
    point.demandUnits = adjustedDemandUnits;
    point.contextMultiplier = activeContextMultiplier;
    point.coveragePhase = coverageFlags.isPrepWindow
      ? "prep"
      : coverageFlags.isCloseWindow
        ? "close"
        : "trading";

    let total = 0;
    roles.forEach((role) => {
      const rawRoleDemandUnits = getCsvDemandUnitsForRole({
        csvDemand: csvCurves,
        role,
        weekday: selectedWeekday,
        slotIndex: csvSlotIndex,
        useWeekdayData: hasWeekdayData,
      });
      const roleDemandUnits =
        rawRoleDemandUnits !== null && rawRoleDemandUnits !== undefined
          ? Math.max(0, rawRoleDemandUnits * activeContextMultiplier)
          : rawRoleDemandUnits;
      const feedbackCorrection = getAverageFeedbackCorrection({
        weekday: selectedWeekday,
        hour: slotLabel,
        roleId: role.id,
        feedbackEntries: staffingFeedback,
      });
      const value = calculateRoleStaff({
        demand,
        demandUnits: adjustedDemandUnits,
        roleDemandUnits,
        role,
        absoluteIndex,
        peak: peakStaff[role.id],
        roleCount: roles.length,
        intervalMinutes,
        operatingRules,
        forceMinimum: forceMinimum && role.requiredDuringOpen,
        feedbackCorrection,
      });
      point[role.id] = value;
      total += value;
    });

    point.total = total;
    const minimumAdjustedPoint = applyMinimumTotalStaff(
      point,
      roles,
      forceMinimum
        ? Math.max(operatingRules.minTotalStaff || 0, 1)
        : operatingRules.minTotalStaff
    );

    const totalFeedbackCorrection = getAverageFeedbackCorrection({
      weekday: selectedWeekday,
      hour: slotLabel,
      roleId: TOTAL_FEEDBACK_ROLE_ID,
      feedbackEntries: staffingFeedback,
    });

    return applyTotalFeedbackCorrection(
      minimumAdjustedPoint,
      roles,
      peakStaff,
      totalFeedbackCorrection
    );
  });

  return stabilizeStaffingRecommendations(rawStaffingPoints, roles, {
    intervalMinutes,
    operatingRules,
    peakStaff,
  });
}
