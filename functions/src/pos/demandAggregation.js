export const POS_DEMAND_MODEL_VERSION = 2;

function parseTimeToMinutes(timeLabel) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeLabel));
  if (!match) {
    throw new Error("Invalid time. Expected HH:MM.");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Invalid time. Expected HH:MM.");
  }

  return hours * 60 + minutes;
}

function formatMinutesAsTime(totalMinutes) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeIntervalMinutes(value) {
  const num = Number(value);
  return num === 15 || num === 30 || num === 60 ? num : 60;
}

function generateTimeSlots(open, close, intervalMinutes = 60) {
  const interval = normalizeIntervalMinutes(intervalMinutes);
  const startMinutes = parseTimeToMinutes(open);
  const endMinutes = parseTimeToMinutes(close);

  if (endMinutes <= startMinutes) return [];

  const slots = [];
  for (
    let minutes = startMinutes;
    minutes < endMinutes;
    minutes += interval
  ) {
    slots.push(formatMinutesAsTime(minutes));
  }

  return slots;
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCounts(counts) {
  const max = Math.max(...counts);
  if (max <= 0) return counts.map(() => 0);
  return counts.map((count) => count / max);
}

function emptyWeekdayValues(slotCount, value = 0) {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      Array(slotCount).fill(value),
    ])
  );
}

function getSlotIndex(timestamp, slotLabels, intervalMinutes) {
  const date = new Date(timestamp);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const slotMinutes =
    Math.floor(minutes / intervalMinutes) * intervalMinutes;
  return slotLabels.indexOf(formatMinutesAsTime(slotMinutes));
}

export function getDemandBucketKey({
  timestamp,
  openingHours,
  intervalMinutes,
}) {
  const interval = normalizeIntervalMinutes(intervalMinutes);
  const slotLabels = generateTimeSlots(
    openingHours.open,
    openingHours.close,
    interval
  );
  const slotIndex = getSlotIndex(timestamp, slotLabels, interval);

  if (slotIndex === -1) return null;

  const date = new Date(timestamp);
  return {
    dateKey: toLocalDateKey(date),
    weekday: date.getDay(),
    slotLabel: slotLabels[slotIndex],
    slotIndex,
    slotLabels,
    intervalMinutes: interval,
  };
}

export function getTransactionAggregate(transaction) {
  return {
    transactionCount: Number(transaction?.transactionCount) || 0,
    revenue: Number(transaction?.revenue) || 0,
    itemCount: Number(transaction?.itemCount) || 0,
  };
}

export function buildIngestionDelta(previousTransaction, nextTransaction) {
  const previous = getTransactionAggregate(previousTransaction);
  const next = getTransactionAggregate(nextTransaction);

  return {
    transactionCount: next.transactionCount - previous.transactionCount,
    revenue: Math.round((next.revenue - previous.revenue) * 100) / 100,
    itemCount: next.itemCount - previous.itemCount,
  };
}

export function createPosDemandModelFromBuckets({
  buckets = [],
  openingHours,
  intervalMinutes = 60,
  now = () => new Date(),
} = {}) {
  const interval = normalizeIntervalMinutes(intervalMinutes);
  const slotLabels = generateTimeSlots(
    openingHours.open,
    openingHours.close,
    interval
  );

  if (slotLabels.length === 0) {
    throw new Error("Opening hours are invalid.");
  }

  const byDate = new Map();

  buckets.forEach((bucket) => {
    const slotIndex = slotLabels.indexOf(bucket.slotLabel);

    if (slotIndex === -1 || !bucket.dateKey) {
      return;
    }

    const current =
      byDate.get(bucket.dateKey) || {
        dateKey: bucket.dateKey,
        weekday: Number(bucket.weekday),
        demandUnits: Array(slotLabels.length).fill(0),
        actualStaff: Array(slotLabels.length).fill(null),
      };

    current.demandUnits[slotIndex] += Math.max(
      0,
      Number(bucket.transactionCount) || 0
    );
    byDate.set(bucket.dateKey, current);
  });

  const days = Array.from(byDate.values());
  const weekdayGroups = Array.from({ length: 7 }, (_, weekday) =>
    days.filter((day) => day.weekday === weekday)
  );

  const average = (group) => {
    if (group.length === 0) return Array(slotLabels.length).fill(0);

    return Array.from({ length: slotLabels.length }, (_, slotIndex) => {
      const total = group.reduce(
        (sum, day) => sum + (day.demandUnits[slotIndex] || 0),
        0
      );
      return total / group.length;
    });
  };

  const fallbackUnits = average(days);
  const byWeekdayUnitsArray = weekdayGroups.map(average);
  const byWeekdayUnits = Object.fromEntries(
    byWeekdayUnitsArray.map((values, weekday) => [weekday, values])
  );
  const byWeekday = Object.fromEntries(
    byWeekdayUnitsArray.map((values, weekday) => [
      weekday,
      normalizeCounts(values),
    ])
  );
  const demandSource = {
    column: "Square transactions",
    type: "events",
    unitLabel: "transactions",
    roleHints: [],
    roleSpecific: false,
    fallback: normalizeCounts(fallbackUnits),
    byWeekday,
    fallbackUnits,
    byWeekdayUnits,
  };

  return {
    modelVersion: POS_DEMAND_MODEL_VERSION,
    source: "square",
    slotLabels,
    intervalMinutes: interval,
    fallback: normalizeCounts(fallbackUnits),
    byWeekday,
    fallbackUnits,
    byWeekdayUnits,
    actualStaffFallback: Array(slotLabels.length).fill(null),
    actualStaffByWeekday: emptyWeekdayValues(slotLabels.length, null),
    demandMetric: {
      column: "Square transactions",
      type: "events",
      unitLabel: "transactions",
    },
    demandColumns: {
      general: {
        key: "transactions",
        index: 0,
        column: "Square transactions",
        type: "events",
        unitLabel: "transactions",
      },
      sources: {
        transactions: {
          key: "transactions",
          index: 0,
          column: "Square transactions",
          type: "events",
          unitLabel: "transactions",
          roleHints: [],
          roleSpecific: false,
        },
      },
      hasRoleSpecificDemand: false,
    },
    demandSources: {
      transactions: demandSource,
    },
    hasRoleSpecificDemand: false,
    dailyDemandByDate: Object.fromEntries(
      days.map((day) => [
        day.dateKey,
        {
          weekday: day.weekday,
          demandUnits: day.demandUnits,
          actualStaff: day.actualStaff,
        },
      ])
    ),
    rows: buckets.reduce(
      (sum, bucket) => sum + Math.max(0, Number(bucket.transactionCount) || 0),
      0
    ),
    totalRows: buckets.length,
    skippedRows: 0,
    invalidRows: [],
    outOfHoursRows: 0,
    actualStaffRows: 0,
    observedDays: days.length,
    weekdaySampleCounts: weekdayGroups.map((group) => group.length),
    lastUpdated: now().toISOString(),
  };
}

export function calculateActualDemandSoFar({
  buckets = [],
  forecastPoints = [],
  dateKey,
  upToTime,
} = {}) {
  const forecastBySlot = new Map(
    forecastPoints.map((point) => [point.hour, Number(point.demandUnits) || 0])
  );
  let actualTransactions = 0;
  let forecastTransactions = 0;

  buckets
    .filter((bucket) => bucket.dateKey === dateKey)
    .forEach((bucket) => {
      if (upToTime && bucket.slotLabel > upToTime) return;
      actualTransactions += Number(bucket.transactionCount) || 0;
      forecastTransactions += forecastBySlot.get(bucket.slotLabel) || 0;
    });

  const variancePercent =
    forecastTransactions > 0
      ? ((actualTransactions - forecastTransactions) / forecastTransactions) * 100
      : null;

  return {
    actualTransactions,
    forecastTransactions,
    variancePercent:
      variancePercent === null ? null : Math.round(variancePercent * 10) / 10,
  };
}
