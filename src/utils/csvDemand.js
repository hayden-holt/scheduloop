import {
  formatMinutesAsTime,
  generateTimeSlots,
  HOURS,
  normalizeIntervalMinutes,
  toLocalDateKey,
} from "./schedule.js";
import { CSV_DEMAND_MODEL_VERSION } from "./demandModel.js";
import {
  detectDemandColumns,
  serializeDetectedDemandColumns,
} from "./roleDemand.js";

export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_COLUMNS = 80;
export const MAX_CSV_CELL_CHARS = 500;

const SAFE_CSV_MIME_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

const ACTUAL_STAFF_PATTERNS = [
  /^staff$/,
  /^staff[_\s-]?count$/,
  /^scheduled[_\s-]?staff$/,
  /^team[_\s-]?size$/,
  /^people[_\s-]?on[_\s-]?shift$/,
  /^employees?$/,
];

export function assertCsvFileIsSafe(file, maxBytes = MAX_CSV_BYTES) {
  if (!file) {
    throw new Error("Choose a CSV file to upload.");
  }

  if (file.size > maxBytes) {
    throw new Error("CSV file is too large. Use a file under 1 MB.");
  }

  const fileName = String(file.name || "").toLowerCase();
  const fileType = String(file.type || "").toLowerCase();

  if (fileName && !fileName.endsWith(".csv")) {
    throw new Error("Upload a CSV file with a .csv extension.");
  }

  if (!SAFE_CSV_MIME_TYPES.has(fileType)) {
    throw new Error("Upload a plain CSV file.");
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error("CSV has an unterminated quoted field.");
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(header) {
  return header.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function isDangerousSpreadsheetValue(value) {
  const trimmed = String(value ?? "").trimStart();
  if (!trimmed) return false;

  const firstChar = trimmed[0];
  if (!["=", "+", "-", "@"].includes(firstChar)) return false;

  return !/^-?\d+(\.\d+)?$/.test(trimmed);
}

function validateCsvRows(rows) {
  if (rows.length - 1 > MAX_CSV_ROWS) {
    throw new Error(`CSV has too many rows. Use ${MAX_CSV_ROWS} rows or fewer.`);
  }

  const headers = rows[0] || [];
  if (headers.length > MAX_CSV_COLUMNS) {
    throw new Error(`CSV has too many columns. Use ${MAX_CSV_COLUMNS} columns or fewer.`);
  }

  const seenHeaders = new Set();
  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    if (!normalized) {
      throw new Error("CSV headers cannot be blank.");
    }
    if (seenHeaders.has(normalized)) {
      throw new Error(`CSV has a duplicate header: ${normalized}.`);
    }
    seenHeaders.add(normalized);
  });

  rows.forEach((row, rowIndex) => {
    if (row.length > MAX_CSV_COLUMNS) {
      throw new Error(`CSV row ${rowIndex + 1} has too many columns.`);
    }

    row.forEach((cell) => {
      if (String(cell ?? "").length > MAX_CSV_CELL_CHARS) {
        throw new Error("CSV contains a value that is too long.");
      }

      if (isDangerousSpreadsheetValue(cell)) {
        throw new Error("CSV contains spreadsheet formula-like values. Remove formulas before uploading.");
      }
    });
  });
}

function findTimestampColumn(headers) {
  return headers.findIndex((header) =>
    /^(time|timestamp|date|datetime|created_at|created at)$/.test(
      normalizeHeader(header)
    )
  );
}

function findActualStaffColumn(headers) {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return ACTUAL_STAFF_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

function parsePositiveNumber(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getSlotIndex(date, slotLabels, intervalMinutes) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const slotMinutes =
    Math.floor(minutes / intervalMinutes) * intervalMinutes;
  const slotLabel = formatMinutesAsTime(slotMinutes);
  return slotLabels.indexOf(slotLabel);
}

function normalizeCounts(counts) {
  const max = Math.max(...counts);
  if (max <= 0) return counts.map(() => 0);
  return counts.map((count) => count / max);
}

function createDateBucket(date, slotCount, sourceKeys = []) {
  return {
    dateKey: toLocalDateKey(date),
    weekday: date.getDay(),
    demandUnits: Array(slotCount).fill(0),
    demandUnitsBySource: Object.fromEntries(
      sourceKeys.map((key) => [key, Array(slotCount).fill(0)])
    ),
    actualStaffSums: Array(slotCount).fill(0),
    actualStaffCounts: Array(slotCount).fill(0),
  };
}

function sumBucketsBySlot(buckets, slotCount) {
  const totals = Array(slotCount).fill(0);

  buckets.forEach((bucket) => {
    bucket.demandUnits.forEach((value, index) => {
      totals[index] += value;
    });
  });

  return totals;
}

function averageDemandByObservedDay(buckets, slotCount) {
  if (buckets.length === 0) return Array(slotCount).fill(0);

  return sumBucketsBySlot(buckets, slotCount).map(
    (value) => value / buckets.length
  );
}

function averageSourceDemandByObservedDay(buckets, slotCount, sourceKey) {
  if (buckets.length === 0) return Array(slotCount).fill(0);

  return Array.from({ length: slotCount }, (_, slotIndex) => {
    const total = buckets.reduce(
      (sum, bucket) =>
        sum + (bucket.demandUnitsBySource?.[sourceKey]?.[slotIndex] || 0),
      0
    );
    return total / buckets.length;
  });
}

function averageActualStaffByObservedSlot(buckets, slotCount) {
  return Array.from({ length: slotCount }, (_, slotIndex) => {
    const observedStaff = buckets
      .map((bucket) =>
        bucket.actualStaffCounts[slotIndex] > 0
          ? bucket.actualStaffSums[slotIndex] /
            bucket.actualStaffCounts[slotIndex]
          : null
      )
      .filter((value) => value !== null);

    if (observedStaff.length === 0) return null;

    return (
      observedStaff.reduce((sum, value) => sum + value, 0) /
      observedStaff.length
    );
  });
}

function toWeekdayMap(values) {
  return Object.fromEntries(values.map((value, weekday) => [weekday, value]));
}

function createFallbackDemandMetric(detectedColumns) {
  if (detectedColumns.general) return detectedColumns.general;

  const firstSource = Object.values(detectedColumns.sources)[0];
  if (firstSource) {
    return {
      ...firstSource,
      column: `${firstSource.column} plus similar demand columns`,
    };
  }

  return {
    index: -1,
    column: null,
    type: "events",
    unitLabel: "events",
  };
}

function getGeneralDemandUnits(cols, detectedColumns) {
  if (detectedColumns.general) {
    return parsePositiveNumber(cols[detectedColumns.general.index]);
  }

  const sourceValues = Object.values(detectedColumns.sources)
    .map((source) => parsePositiveNumber(cols[source.index]))
    .filter((value) => value !== null);

  if (sourceValues.length === 0) {
    return Object.keys(detectedColumns.sources).length === 0 ? 1 : null;
  }

  // When no single general column exists, use the combined workload columns as
  // a safe fallback so richer role-specific CSVs still produce a total curve.
  return sourceValues.reduce((sum, value) => sum + value, 0);
}

function buildSourceDemandModel(dateBuckets, weekdayBuckets, source, slotCount) {
  const fallbackUnits = averageSourceDemandByObservedDay(
    dateBuckets,
    slotCount,
    source.key
  );
  const byWeekdayUnits = weekdayBuckets.map((buckets) =>
    averageSourceDemandByObservedDay(buckets, slotCount, source.key)
  );

  return {
    column: source.column,
    type: source.type,
    unitLabel: source.unitLabel,
    roleHints: source.roleHints,
    roleSpecific: !!source.roleSpecific,
    fallback: normalizeCounts(fallbackUnits),
    byWeekday: toWeekdayMap(byWeekdayUnits.map(normalizeCounts)),
    fallbackUnits,
    byWeekdayUnits: toWeekdayMap(byWeekdayUnits),
  };
}

export function parseCsvDemand(
  text,
  {
    openingHours = { open: HOURS[0], close: HOURS[HOURS.length - 1] },
    intervalMinutes = 60,
    now = () => new Date(),
  } = {}
) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("The CSV looks empty.");
  }

  const interval = normalizeIntervalMinutes(intervalMinutes);
  const slotLabels = generateTimeSlots(
    openingHours.open,
    openingHours.close,
    interval
  );

  if (slotLabels.length === 0) {
    throw new Error("Opening hours are invalid.");
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("The CSV looks empty or has no data rows.");
  }
  validateCsvRows(rows);

  const headers = rows[0];
  const timeIdx = findTimestampColumn(headers);

  if (timeIdx === -1) {
    throw new Error(
      "Could not find a time, timestamp, date, or datetime column."
    );
  }

  const detectedColumns = detectDemandColumns(headers);
  const demandMetric = createFallbackDemandMetric(detectedColumns);
  const sourceKeys = Object.keys(detectedColumns.sources);
  const actualStaffIdx = findActualStaffColumn(headers);
  const dateBucketsByKey = new Map();

  const invalidRows = [];
  let matchedRows = 0;
  let outOfHoursRows = 0;
  let actualStaffRows = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i];
    const rowNumber = i + 1;

    if (cols.length <= timeIdx) {
      invalidRows.push({ row: rowNumber, reason: "Missing timestamp" });
      continue;
    }

    const rawTs = cols[timeIdx].trim();
    const parsed = new Date(rawTs);

    if (!rawTs || Number.isNaN(parsed.getTime())) {
      invalidRows.push({ row: rowNumber, reason: "Invalid timestamp" });
      continue;
    }

    const slotIndex = getSlotIndex(parsed, slotLabels, interval);
    if (slotIndex === -1) {
      outOfHoursRows += 1;
      continue;
    }

    const demandUnits = getGeneralDemandUnits(cols, detectedColumns);

    if (!demandUnits) {
      invalidRows.push({ row: rowNumber, reason: "Invalid demand value" });
      continue;
    }

    const dateKey = toLocalDateKey(parsed);
    const bucket =
      dateBucketsByKey.get(dateKey) ||
      createDateBucket(parsed, slotLabels.length, sourceKeys);

    dateBucketsByKey.set(dateKey, bucket);
    bucket.demandUnits[slotIndex] += demandUnits;

    Object.values(detectedColumns.sources).forEach((source) => {
      const sourceValue = parsePositiveNumber(cols[source.index]);
      if (sourceValue !== null) {
        bucket.demandUnitsBySource[source.key][slotIndex] += sourceValue;
      }
    });

    matchedRows += 1;

    if (actualStaffIdx !== -1 && cols.length > actualStaffIdx) {
      const actualStaff = parsePositiveNumber(cols[actualStaffIdx]);
      if (actualStaff) {
        bucket.actualStaffSums[slotIndex] += actualStaff;
        bucket.actualStaffCounts[slotIndex] += 1;
        actualStaffRows += 1;
      }
    }
  }

  if (matchedRows === 0) {
    throw new Error(
      `No valid rows matched opening hours ${openingHours.open}-${openingHours.close}.`
    );
  }

  const dateBuckets = Array.from(dateBucketsByKey.values());
  const weekdayBuckets = Array.from({ length: 7 }, (_, weekday) =>
    dateBuckets.filter((bucket) => bucket.weekday === weekday)
  );
  const fallbackUnits = averageDemandByObservedDay(
    dateBuckets,
    slotLabels.length
  );
  const byWeekdayUnits = weekdayBuckets.map((buckets) =>
    averageDemandByObservedDay(buckets, slotLabels.length)
  );
  const byWeekday = byWeekdayUnits.map(normalizeCounts);
  const actualStaffByWeekday = weekdayBuckets.map((buckets) =>
    averageActualStaffByObservedSlot(buckets, slotLabels.length)
  );
  const demandSources = Object.fromEntries(
    Object.entries(detectedColumns.sources).map(([key, source]) => [
      key,
      buildSourceDemandModel(dateBuckets, weekdayBuckets, source, slotLabels.length),
    ])
  );
  const dailyDemandByDate = Object.fromEntries(
    dateBuckets.map((bucket) => [
      bucket.dateKey,
      {
        weekday: bucket.weekday,
        demandUnits: bucket.demandUnits,
        actualStaff: averageActualStaffByObservedSlot([bucket], slotLabels.length),
      },
    ])
  );

  return {
    modelVersion: CSV_DEMAND_MODEL_VERSION,
    slotLabels,
    intervalMinutes: interval,
    fallback: normalizeCounts(fallbackUnits),
    byWeekday: toWeekdayMap(byWeekday),
    fallbackUnits,
    byWeekdayUnits: toWeekdayMap(byWeekdayUnits),
    actualStaffFallback: averageActualStaffByObservedSlot(
      dateBuckets,
      slotLabels.length
    ),
    actualStaffByWeekday: toWeekdayMap(actualStaffByWeekday),
    demandMetric: serializeDetectedDemandColumns({
      general: demandMetric,
      sources: {},
    }).general,
    demandColumns: serializeDetectedDemandColumns(detectedColumns),
    demandSources,
    hasRoleSpecificDemand: detectedColumns.hasRoleSpecificDemand,
    dailyDemandByDate,
    rows: matchedRows,
    totalRows: rows.length - 1,
    skippedRows: invalidRows.length + outOfHoursRows,
    invalidRows: invalidRows.slice(0, 5),
    outOfHoursRows,
    actualStaffRows,
    observedDays: dateBuckets.length,
    weekdaySampleCounts: weekdayBuckets.map((buckets) => buckets.length),
    lastUpdated: now().toISOString(),
  };
}
