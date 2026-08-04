import { getHourIndexForSlot } from "./schedule.js";

const ROLE_SHAPE_MULTIPLIERS = {
  barista: {
    morning: 1.12,
    lunch: 1.06,
    late: 0.95,
  },
  kitchen: {
    preLunch: 1.08,
    lunch: 1.1,
    afternoon: 1.03,
  },
  wait: {
    lunch: 1.14,
    evening: 1.08,
    morning: 0.94,
  },
  frontDesk: {
    morning: 1.08,
    evening: 1.08,
  },
  trainer: {
    morning: 1.04,
    evening: 1.12,
    lunch: 0.96,
  },
  classes: {
    morning: 1.1,
    lunch: 1.04,
    evening: 1.12,
  },
  cleaner: {
    early: 1.08,
    late: 1.1,
  },
};

const MIN_STAFFING_BLOCK_MINUTES = 120;
const STAFFING_GAP_TOLERANCE_SLOTS = 1;

export function normalizeStaffCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

export function normalizePositiveNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

function getRoleKind(role) {
  const id = String(role?.id || "").toLowerCase();
  const name = String(role?.name || "").toLowerCase();
  const text = `${id} ${name}`;

  if (text.includes("barista") || text.includes("front of house")) {
    return "barista";
  }
  if (text.includes("kitchen") || text.includes("chef")) return "kitchen";
  if (text.includes("wait") || text.includes("floor")) return "wait";
  if (
    text.includes("frontdesk") ||
    text.includes("front desk") ||
    text.includes("reception")
  ) {
    return "frontDesk";
  }
  if (text.includes("pt") || text.includes("trainer")) return "trainer";
  if (text.includes("class") || text.includes("instructor")) return "classes";
  if (text.includes("clean")) return "cleaner";
  return "default";
}

function getDayPart(absoluteIndex) {
  if (absoluteIndex <= 2) return "early";
  if (absoluteIndex <= 5) return "morning";
  if (absoluteIndex <= 6) return "preLunch";
  if (absoluteIndex <= 9) return "lunch";
  if (absoluteIndex <= 12) return "afternoon";
  if (absoluteIndex <= 16) return "evening";
  return "late";
}

function getOperationalRoleShapeMultiplier(role, absoluteIndex) {
  const multipliers = ROLE_SHAPE_MULTIPLIERS[getRoleKind(role)];
  if (!multipliers) return 1;
  return multipliers[getDayPart(absoluteIndex)] || 1;
}

function getRoleShapeFactor(role, absoluteIndex) {
  const curve = Array.isArray(role?.curve) ? role.curve : [];
  const numericCurve = curve.map((value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
  });
  const rawShapeVal = numericCurve[absoluteIndex] ?? 0;
  const maxRoleCurve = Math.max(...numericCurve, 0);
  const shapeFraction = maxRoleCurve > 0 ? rawShapeVal / maxRoleCurve : 1;

  const operationalMultiplier = getOperationalRoleShapeMultiplier(
    role,
    absoluteIndex
  );
  // Deterministic role-specific shaping keeps forecasts repeatable while
  // preventing different roles from tracking the exact same curve.
  const roleShapeFactor = Math.min(
    Math.max((0.5 + 0.5 * shapeFraction) * operationalMultiplier, 0.4),
    1.25
  );

  return {
    rawShapeVal,
    roleShapeFactor,
  };
}

export function calculateRoleStaff({
  demand,
  demandUnits = null,
  roleDemandUnits = null,
  role,
  absoluteIndex,
  peak,
  roleCount = 1,
  intervalMinutes = 60,
  operatingRules = {},
  forceMinimum = false,
  feedbackCorrection = 0,
}) {
  const safeDemand = Math.min(Math.max(Number(demand) || 0, 0), 1.5);
  const peakCount = normalizeStaffCount(peak);
  const configuredMin =
    role?.minStaff === undefined && role?.requiredDuringOpen
      ? 1
      : role?.minStaff;
  const minStaff = normalizeStaffCount(configuredMin);
  const maxStaff =
    normalizeStaffCount(role?.maxStaff) || peakCount || Math.max(minStaff, 5);
  const serviceRate = normalizePositiveNumber(
    role?.productivityPerHour ?? role?.serviceRate,
    25
  );
  const demandWeight = normalizePositiveNumber(role?.demandWeight, 1);
  const defaultDemandShare =
    role?.demandWeight === undefined ? 1 / Math.max(1, roleCount) : 1;
  const demandShare = normalizePositiveNumber(
    role?.demandShare,
    defaultDemandShare
  );
  const slotHours = Math.max(0.25, Number(intervalMinutes) / 60 || 1);
  const demandBuffer =
    normalizePositiveNumber(operatingRules.demandBufferPercent, 0) / 100;
  const breakAllowance =
    normalizePositiveNumber(operatingRules.breakAllowancePercent, 0) / 100;
  const bufferMultiplier = 1 + demandBuffer + breakAllowance;
  const { rawShapeVal, roleShapeFactor } = getRoleShapeFactor(
    role,
    absoluteIndex
  );

  let value = 0;
  const sourceDemandUnits =
    roleDemandUnits !== null && roleDemandUnits !== undefined
      ? roleDemandUnits
      : demandUnits;

  if (sourceDemandUnits !== null && serviceRate > 0) {
    const capacityPerStaffSlot = serviceRate * slotHours;
    // Absolute CSV demand is easiest to explain: expected units divided by the
    // number this role can handle in the selected time block.
    const weightedDemand =
      normalizePositiveNumber(sourceDemandUnits, 0) *
      demandWeight *
      demandShare *
      roleShapeFactor *
      bufferMultiplier;
    value =
      weightedDemand <= 0 ? 0 : Math.max(1, Math.ceil(weightedDemand / capacityPerStaffSlot));
  } else if (safeDemand >= 0.01 && peakCount > 0) {
    const raw = safeDemand * peakCount * roleShapeFactor * bufferMultiplier;
    value = raw <= 0 ? 0 : Math.max(1, Math.round(raw));
  } else if (safeDemand >= 0.01) {
    const fallback = safeDemand * rawShapeVal * bufferMultiplier;
    value = fallback <= 0 ? 0 : Math.max(1, Math.round(fallback));
  }

  if (
    (forceMinimum || value > 0 || (role?.requiredDuringOpen && safeDemand > 0)) &&
    minStaff > 0
  ) {
    value = Math.max(value, minStaff);
  }

  const correctionValue = Number(feedbackCorrection);
  const correction = Number.isFinite(correctionValue)
    ? Math.round(correctionValue)
    : 0;
  if (correction !== 0 && (value > 0 || correction > 0)) {
    value += correction;
  }

  return Math.max(0, Math.min(Math.max(maxStaff, minStaff), value));
}

function bridgeShortStaffingGaps(needsLevel, gapTolerance) {
  const next = [...needsLevel];
  let index = 0;

  while (index < next.length) {
    if (next[index]) {
      index += 1;
      continue;
    }

    const gapStart = index;
    while (index < next.length && !next[index]) index += 1;
    const gapEnd = index - 1;
    const hasNeedBefore = gapStart > 0 && next[gapStart - 1];
    const hasNeedAfter = index < next.length && next[index];
    const gapLength = gapEnd - gapStart + 1;

    if (hasNeedBefore && hasNeedAfter && gapLength <= gapTolerance) {
      for (let gapIndex = gapStart; gapIndex <= gapEnd; gapIndex += 1) {
        next[gapIndex] = true;
      }
    }
  }

  return next;
}

function removeShortStaffingRuns(needsLevel, minimumRunSlots) {
  const next = [...needsLevel];
  let index = 0;

  while (index < next.length) {
    if (!next[index]) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < next.length && next[index]) index += 1;
    const runEnd = index - 1;
    const runLength = runEnd - runStart + 1;

    if (runLength < minimumRunSlots) {
      for (let runIndex = runStart; runIndex <= runEnd; runIndex += 1) {
        next[runIndex] = false;
      }
    }
  }

  return next;
}

function stabilizeStaffingRun(values, minimumRunSlots) {
  if (values.length === 0) return [];

  const safeValues = values.map(normalizeStaffCount);
  const maxValue = Math.max(...safeValues, 0);
  const stableValues = Array(values.length).fill(0);
  const effectiveMinimumRunSlots = Math.max(
    1,
    Math.min(minimumRunSlots, values.length)
  );

  for (let level = 1; level <= maxValue; level += 1) {
    const needsLevel = safeValues.map((value) => value >= level);
    const bridgedNeeds = bridgeShortStaffingGaps(
      needsLevel,
      STAFFING_GAP_TOLERANCE_SLOTS
    );
    const stableNeeds = removeShortStaffingRuns(
      bridgedNeeds,
      effectiveMinimumRunSlots
    );

    stableNeeds.forEach((isNeeded, index) => {
      if (isNeeded) stableValues[index] += 1;
    });
  }

  return stableValues;
}

function getRoleStaffCap(role, peak) {
  const minStaff = normalizeStaffCount(role?.minStaff);
  const peakCount = normalizeStaffCount(peak);
  const maxStaff =
    normalizeStaffCount(role?.maxStaff) || peakCount || Math.max(minStaff, 5);
  return Math.max(maxStaff, minStaff);
}

function getContiguousTradingRuns(points) {
  const runs = [];
  let currentRun = [];

  points.forEach((point, index) => {
    const isTrading = (point.coveragePhase || "trading") === "trading";

    if (isTrading) {
      currentRun.push(index);
      return;
    }

    if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  });

  if (currentRun.length > 0) runs.push(currentRun);

  return runs;
}

export function stabilizeStaffingRecommendations(
  points,
  roles = [],
  { intervalMinutes = 60, operatingRules = {}, peakStaff = {} } = {}
) {
  if (!Array.isArray(points) || points.length === 0 || roles.length === 0) {
    return points || [];
  }

  const minimumRunSlots = Math.max(
    1,
    Math.ceil(MIN_STAFFING_BLOCK_MINUTES / Math.max(15, intervalMinutes || 60))
  );
  const nextPoints = points.map((point) => ({ ...point }));
  const tradingRuns = getContiguousTradingRuns(nextPoints);

  roles.forEach((role) => {
    const cap = getRoleStaffCap(role, peakStaff?.[role.id]);

    tradingRuns.forEach((runIndexes) => {
      const rawValues = runIndexes.map((pointIndex) =>
        normalizeStaffCount(nextPoints[pointIndex][role.id])
      );
      const stableValues = stabilizeStaffingRun(rawValues, minimumRunSlots);

      runIndexes.forEach((pointIndex, runIndex) => {
        nextPoints[pointIndex][role.id] = Math.min(
          cap,
          stableValues[runIndex]
        );
      });
    });
  });

  return nextPoints.map((point) => {
    const total = roles.reduce(
      (sum, role) => sum + normalizeStaffCount(point[role.id]),
      0
    );
    const minimumTotal =
      point.coveragePhase === "prep" || point.coveragePhase === "close"
        ? Math.max(operatingRules.minTotalStaff || 0, 1)
        : operatingRules.minTotalStaff;

    return applyMinimumTotalStaff(
      {
        ...point,
        total,
      },
      roles,
      minimumTotal
    );
  });
}

export function applyMinimumTotalStaff(point, roles, minimumTotal) {
  const minTotal = normalizeStaffCount(minimumTotal);
  if (minTotal <= 0 || point.total >= minTotal || roles.length === 0) {
    return point;
  }

  const preferredRole =
    roles.find((role) => role.requiredDuringOpen) || roles[0];
  const gap = minTotal - point.total;

  return {
    ...point,
    [preferredRole.id]: (point[preferredRole.id] || 0) + gap,
    total: minTotal,
  };
}

export function calculateBacktestSummary(chartData, csvDemand, weekday) {
  if (!csvDemand?.slotLabels || !chartData?.length) {
    return null;
  }

  const weekdayActual = csvDemand.actualStaffByWeekday?.[weekday] || [];
  const fallbackActual = csvDemand.actualStaffFallback || [];
  const comparisons = [];

  chartData.forEach((point) => {
    const slotIndex = csvDemand.slotLabels.indexOf(point.hour);
    if (slotIndex === -1) return;

    const actual =
      weekdayActual[slotIndex] !== null && weekdayActual[slotIndex] !== undefined
        ? weekdayActual[slotIndex]
        : fallbackActual[slotIndex];

    if (actual === null || actual === undefined) return;

    comparisons.push({
      predicted: point.total || 0,
      actual,
      error: (point.total || 0) - actual,
    });
  });

  if (comparisons.length === 0) return null;

  const absoluteError = comparisons.reduce(
    (sum, item) => sum + Math.abs(item.error),
    0
  );
  const underStaffedBlocks = comparisons.filter(
    (item) => item.error < -0.5
  ).length;
  const overStaffedBlocks = comparisons.filter((item) => item.error > 0.5)
    .length;

  return {
    blocksCompared: comparisons.length,
    meanAbsoluteError: absoluteError / comparisons.length,
    underStaffedBlocks,
    overStaffedBlocks,
  };
}

function averageSlotDemand(days, slotIndex, weekday) {
  const matchingWeekdayDays = days.filter((day) => day.weekday === weekday);
  const trainingDays =
    matchingWeekdayDays.length > 0 ? matchingWeekdayDays : days;
  const values = trainingDays
    .map((day) => day.demandUnits?.[slotIndex])
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function estimateTotalStaffForDemand({
  demandUnits,
  maxTrainingDemand,
  roles,
  slotLabel,
  intervalMinutes,
  operatingRules,
  peakStaff,
}) {
  const demandScore =
    maxTrainingDemand > 0 ? Math.min(demandUnits / maxTrainingDemand, 1.5) : 0;

  return roles.reduce((sum, role) => {
    const roleStaff = calculateRoleStaff({
      demand: demandScore,
      demandUnits,
      role,
      absoluteIndex: getHourIndexForSlot(slotLabel),
      peak: peakStaff?.[role.id],
      roleCount: roles.length,
      intervalMinutes,
      operatingRules,
      forceMinimum: !!role.requiredDuringOpen && demandScore > 0,
    });

    return sum + roleStaff;
  }, 0);
}

export function runForecastBacktest({
  historicalData,
  roles = [],
  businessProfile = {},
} = {}) {
  const dailyDemandByDate = historicalData?.dailyDemandByDate || {};
  const days = Object.entries(dailyDemandByDate)
    .map(([date, day]) => ({ date, ...day }))
    .filter((day) => Array.isArray(day.demandUnits))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (days.length < 7 || roles.length === 0) {
    return {
      status: "not_enough_data",
      summary: "Backtest needs at least 7 observed days of CSV data.",
      sampleSize: days.length,
    };
  }

  const splitIndex = Math.max(1, Math.floor(days.length * 0.75));
  const trainingDays = days.slice(0, splitIndex);
  const testDays = days.slice(splitIndex);
  const slotLabels = historicalData.slotLabels || [];
  const intervalMinutes = historicalData.intervalMinutes || 60;
  const operatingRules = businessProfile.operatingRules || {};
  const peakStaff = businessProfile.peakStaff || {};
  const maxTrainingDemand = trainingDays.reduce((max, day) => {
    const dayMax = (day.demandUnits || [])
      .filter((value) => Number.isFinite(value))
      .reduce((innerMax, value) => Math.max(innerMax, value), 0);
    return Math.max(max, dayMax);
  }, 0);

  const demandErrors = [];
  const staffErrors = [];
  const peakStaffErrors = [];
  let understaffed = 0;
  let overstaffed = 0;

  testDays.forEach((day) => {
    slotLabels.forEach((slotLabel, slotIndex) => {
      const actualDemand = day.demandUnits?.[slotIndex];
      if (!Number.isFinite(actualDemand)) return;

      const predictedDemand = averageSlotDemand(
        trainingDays,
        slotIndex,
        day.weekday
      );
      demandErrors.push(Math.abs(predictedDemand - actualDemand));

      const actualStaff = day.actualStaff?.[slotIndex];
      if (!Number.isFinite(actualStaff)) return;

      const predictedStaff = estimateTotalStaffForDemand({
        demandUnits: predictedDemand,
        maxTrainingDemand,
        roles,
        slotLabel,
        intervalMinutes,
        operatingRules,
        peakStaff,
      });
      const staffError = predictedStaff - actualStaff;
      staffErrors.push(Math.abs(staffError));

      if (actualDemand >= maxTrainingDemand * 0.7) {
        peakStaffErrors.push(Math.abs(staffError));
      }

      if (staffError < -0.5) understaffed += 1;
      if (staffError > 0.5) overstaffed += 1;
    });
  });

  if (demandErrors.length === 0) {
    return {
      status: "not_enough_data",
      summary: "Backtest needs usable demand rows in the test period.",
      sampleSize: days.length,
    };
  }

  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const staffSampleSize = staffErrors.length;
  const averageStaffError = average(staffErrors);

  return {
    status: "ready",
    averageDemandError: average(demandErrors),
    averageStaffError,
    peakHourStaffError: average(peakStaffErrors),
    understaffingRisk: staffSampleSize ? understaffed / staffSampleSize : null,
    overstaffingRisk: staffSampleSize ? overstaffed / staffSampleSize : null,
    sampleSize: days.length,
    summary:
      averageStaffError === null
        ? `Backtest compared demand across ${days.length} observed days.`
        : `Backtest: usually within ${averageStaffError.toFixed(
            1
          )} staff per hour based on ${days.length} observed days.`,
  };
}
