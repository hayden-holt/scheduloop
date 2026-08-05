import {
  formatMinutesAsTime,
  parseLocalDateKey,
  parseTimeToMinutes,
  toLocalDateKey,
} from "./schedule.js";
import { normalizeHourlyWage } from "./labourCost.js";

export const ROTA_STATUS = {
  draft: "draft",
  published: "published",
};

export const DEFAULT_BREAK_MINUTES = 0;
export const COVERAGE_TOLERANCE = 0.01;

export const COVERAGE_STATUS = {
  under: "under",
  matched: "matched",
  over: "over",
  roleMismatch: "roleMismatch",
};

export function addDaysToDateKey(dateKey, days) {
  const date = parseLocalDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function getWeekStartDateKey(dateKey = toLocalDateKey(new Date())) {
  const date = parseLocalDateKey(dateKey);
  const day = date.getDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return toLocalDateKey(date);
}

export function getWeekDays(weekStartKey) {
  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDaysToDateKey(weekStartKey, index);
    const date = parseLocalDateKey(dateKey);

    return {
      dateKey,
      label: date.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "short",
      }),
      shortLabel: date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
      }),
    };
  });
}

export function getWeekRangeLabel(weekStartKey) {
  const days = getWeekDays(weekStartKey);
  const first = parseLocalDateKey(days[0].dateKey);
  const last = parseLocalDateKey(days[6].dateKey);
  const options = { day: "numeric", month: "short" };

  return `${first.toLocaleDateString(undefined, options)} - ${last.toLocaleDateString(
    undefined,
    options
  )}`;
}

export function normalizeBreakMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return DEFAULT_BREAK_MINUTES;
  return Math.round(num);
}

export function calculateShiftDurationMinutes({
  startTime,
  endTime,
  breakMinutes = DEFAULT_BREAK_MINUTES,
} = {}) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) return 0;

  return Math.max(0, end - start - normalizeBreakMinutes(breakMinutes));
}

export function calculateShiftDurationHours(shift = {}) {
  const minutes = calculateShiftDurationMinutes(shift);
  return Math.round((minutes / 60) * 100) / 100;
}

export function getShiftTimeRange(shift = {}) {
  const start = parseTimeToMinutes(shift.startTime);
  const end = parseTimeToMinutes(shift.endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

export function hasOverlappingShift(candidate, shifts = [], editingShiftId = "") {
  const candidateRange = getShiftTimeRange(candidate);
  if (!candidateRange || !candidate?.employeeId || !candidate?.date) {
    return false;
  }

  return shifts.some((shift) => {
    if (shift.id && shift.id === editingShiftId) return false;
    if (shift.employeeId !== candidate.employeeId) return false;
    if (shift.date !== candidate.date) return false;

    const range = getShiftTimeRange(shift);
    if (!range) return false;

    return candidateRange.start < range.end && candidateRange.end > range.start;
  });
}

export function validateShift(
  shift,
  { employees = [], shifts = [], editingShiftId = "" } = {}
) {
  const errors = {};
  const employeeExists = employees.some(
    (employee) => employee.id === shift?.employeeId
  );
  const start = parseTimeToMinutes(shift?.startTime);
  const end = parseTimeToMinutes(shift?.endTime);
  const breakMinutes = normalizeBreakMinutes(shift?.breakMinutes);

  if (!shift?.employeeId) {
    errors.employeeId = "Choose an employee.";
  } else if (!employeeExists) {
    errors.employeeId = "This employee could not be found.";
  }

  if (!shift?.date) errors.date = "Choose a date.";
  if (start === null) errors.startTime = "Choose a valid start time.";
  if (end === null) errors.endTime = "Choose a valid end time.";

  if (start !== null && end !== null) {
    if (end <= start) {
      errors.endTime = "End time must be after start time.";
    } else if (breakMinutes >= end - start) {
      errors.breakMinutes = "Break must be shorter than the shift.";
    }
  }

  if (!shift?.roleId) errors.roleId = "Choose a role.";

  if (hasOverlappingShift(shift, shifts, editingShiftId)) {
    errors.overlap = "This overlaps another shift for the same employee.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function normalizeEmployeeForm(employee = {}) {
  return {
    displayName: String(employee.displayName || "").trim(),
    defaultRole: String(employee.defaultRole || ""),
    hourlyRate: normalizeHourlyWage(employee.hourlyRate),
    active: employee.active !== false,
  };
}

export function validateEmployee(employee = {}) {
  const errors = {};
  const normalized = normalizeEmployeeForm(employee);

  if (!normalized.displayName) {
    errors.displayName = "Enter the employee's name.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    normalized,
  };
}

function getRoleWage(roleId, roles = [], averageHourlyWage = null) {
  const role = roles.find((item) => item.id === roleId);
  return normalizeHourlyWage(role?.hourlyWage) ?? normalizeHourlyWage(averageHourlyWage);
}

function getEmployeeWage(employeeId, employees = []) {
  const employee = employees.find((item) => item.id === employeeId);
  return normalizeHourlyWage(employee?.hourlyRate);
}

export function calculateShiftCost({
  shift,
  employees = [],
  roles = [],
  averageHourlyWage = null,
} = {}) {
  const hours = calculateShiftDurationHours(shift);
  const wage =
    getEmployeeWage(shift?.employeeId, employees) ??
    getRoleWage(shift?.roleId, roles, averageHourlyWage);

  if (wage === null) return null;
  return Math.round(hours * wage * 100) / 100;
}

export function calculateWeeklyRotaTotals({
  shifts = [],
  employees = [],
  weekDays = [],
  roles = [],
  averageHourlyWage = null,
} = {}) {
  const employeeHours = Object.fromEntries(
    employees.map((employee) => [employee.id, 0])
  );
  const dailyHours = Object.fromEntries(
    weekDays.map((day) => [day.dateKey, 0])
  );
  let weeklyHours = 0;
  let weeklyCost = 0;
  let costedHours = 0;

  shifts.forEach((shift) => {
    const hours = calculateShiftDurationHours(shift);
    weeklyHours += hours;
    employeeHours[shift.employeeId] = (employeeHours[shift.employeeId] || 0) + hours;
    dailyHours[shift.date] = (dailyHours[shift.date] || 0) + hours;

    const cost = calculateShiftCost({
      shift,
      employees,
      roles,
      averageHourlyWage,
    });

    if (cost !== null) {
      weeklyCost += cost;
      costedHours += hours;
    }
  });

  return {
    employeeHours,
    dailyHours,
    weeklyHours: Math.round(weeklyHours * 100) / 100,
    weeklyCost: costedHours > 0 ? Math.round(weeklyCost * 100) / 100 : null,
    costedHours: Math.round(costedHours * 100) / 100,
  };
}

function getSlotEndTime(slotLabel, intervalMinutes) {
  const start = parseTimeToMinutes(slotLabel);
  if (start === null) return null;
  return formatMinutesAsTime(start + intervalMinutes);
}

export function roundCoverageValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

export function formatCoverageValue(value) {
  const rounded = roundCoverageValue(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function getCoverageStatus(difference, tolerance = COVERAGE_TOLERANCE) {
  const numeric = Number(difference);
  if (!Number.isFinite(numeric)) return COVERAGE_STATUS.matched;
  if (numeric < -tolerance) return COVERAGE_STATUS.under;
  if (numeric > tolerance) return COVERAGE_STATUS.over;
  return COVERAGE_STATUS.matched;
}

export function getIntervalOverlapMinutes(slotStart, slotEnd, rangeStart, rangeEnd) {
  if (
    !Number.isFinite(slotStart) ||
    !Number.isFinite(slotEnd) ||
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    slotEnd <= slotStart ||
    rangeEnd <= rangeStart
  ) {
    return 0;
  }

  return Math.max(0, Math.min(slotEnd, rangeEnd) - Math.max(slotStart, rangeStart));
}

export function calculateShiftIntervalContribution(shift, slotStart, slotEnd) {
  const range = getShiftTimeRange(shift);
  const intervalMinutes = slotEnd - slotStart;

  if (!range || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return 0;
  }

  return getIntervalOverlapMinutes(slotStart, slotEnd, range.start, range.end) / intervalMinutes;
}

function sumScheduledContribution({ shifts = [], slotStart, slotEnd, roleId = "" }) {
  return shifts.reduce((total, shift) => {
    if (roleId && shift.roleId !== roleId) return total;
    return total + calculateShiftIntervalContribution(shift, slotStart, slotEnd);
  }, 0);
}

function getStatusLabel(status) {
  if (status === COVERAGE_STATUS.under) return "Understaffed";
  if (status === COVERAGE_STATUS.over) return "Overstaffed";
  if (status === COVERAGE_STATUS.roleMismatch) return "Role mismatch";
  return "Matched";
}

export function calculateCoverageForDay({
  forecastPoints = [],
  shifts = [],
  roles = [],
  intervalMinutes = 60,
} = {}) {
  const safeIntervalMinutes = Math.max(1, Number(intervalMinutes) || 60);

  return forecastPoints
    .filter((point) => point?.hour)
    .map((point) => {
      const slotStart = parseTimeToMinutes(point.hour);
      const slotEnd =
        slotStart === null ? null : slotStart + safeIntervalMinutes;
      const roleCoverage = roles.map((role) => {
        const recommended = roundCoverageValue(Math.max(0, Number(point[role.id]) || 0));
        const scheduled =
          slotEnd === null
            ? 0
            : roundCoverageValue(
                sumScheduledContribution({
                  shifts,
                  slotStart,
                  slotEnd,
                  roleId: role.id,
                })
              );
        const difference = roundCoverageValue(scheduled - recommended);
        const status = getCoverageStatus(difference);

        return {
          roleId: role.id,
          roleName: role.name || role.id,
          recommended,
          scheduled,
          difference,
          status,
          statusLabel: getStatusLabel(status),
        };
      });
      const recommendedTotal = roundCoverageValue(Math.max(0, Number(point.total) || 0));
      const scheduledTotal =
        slotEnd === null
          ? 0
          : roundCoverageValue(sumScheduledContribution({ shifts, slotStart, slotEnd }));
      const difference = roundCoverageValue(scheduledTotal - recommendedTotal);
      const totalStatus = getCoverageStatus(difference);
      const hasRoleMismatch =
        totalStatus === COVERAGE_STATUS.matched &&
        roleCoverage.some((role) => role.status !== COVERAGE_STATUS.matched);
      const status = hasRoleMismatch ? COVERAGE_STATUS.roleMismatch : totalStatus;

      return {
        hour: point.hour,
        endHour: getSlotEndTime(point.hour, safeIntervalMinutes),
        recommendedTotal,
        scheduledTotal,
        difference,
        status,
        statusLabel: getStatusLabel(status),
        roleCoverage,
      };
    });
}

export function getCoverageSummary(coverageRows = []) {
  const totals = coverageRows.reduce(
    (summary, row) => {
      if (summary[row.status] !== undefined) {
        summary[row.status] += 1;
      }
      return summary;
    },
    { under: 0, matched: 0, over: 0, roleMismatch: 0 }
  );

  return {
    ...totals,
    hasCoverage: coverageRows.length > 0,
    needsAttention: totals.under + totals.over + totals.roleMismatch,
  };
}

export function getCoverageWarnings(coverageRows = []) {
  return coverageRows
    .filter((row) => row.status !== "matched")
    .slice(0, 6)
    .map((row) => {
      const amount = Math.abs(row.difference);
      const staffLabel =
        amount === 1
          ? "1 person"
          : `${formatCoverageValue(amount)} people`;
      if (row.status === COVERAGE_STATUS.roleMismatch) {
        return `${row.hour}-${row.endHour}: total cover matches, but roles do not.`;
      }
      const direction =
        row.status === COVERAGE_STATUS.under
          ? "fewer than recommended"
          : "more than recommended";

      return `${row.hour}-${row.endHour}: ${staffLabel} ${direction}.`;
    });
}

export function copyShiftsToWeek(sourceShifts = [], targetWeekStartKey) {
  return sourceShifts.map((shift) => {
    const sourceWeekStart = getWeekStartDateKey(shift.date);
    const dayOffset =
      (parseLocalDateKey(shift.date) - parseLocalDateKey(sourceWeekStart)) /
      (24 * 60 * 60 * 1000);

    return {
      employeeId: shift.employeeId,
      date: addDaysToDateKey(targetWeekStartKey, dayOffset),
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: targetWeekStartKey,
    };
  });
}

function shiftsAreExactDuplicates(candidate = {}, existing = {}) {
  return (
    candidate.employeeId === existing.employeeId &&
    candidate.date === existing.date &&
    candidate.startTime === existing.startTime &&
    candidate.endTime === existing.endTime &&
    candidate.roleId === existing.roleId &&
    normalizeBreakMinutes(candidate.breakMinutes) ===
      normalizeBreakMinutes(existing.breakMinutes)
  );
}

export function isExactDuplicateShift(candidate, shifts = []) {
  return shifts.some((shift) => shiftsAreExactDuplicates(candidate, shift));
}

function getCopyIssueLabels(issues = []) {
  const labels = {
    exactDuplicate: "Exact duplicate",
    overlap: "Overlaps existing shift",
    inactiveEmployee: "Inactive employee",
    missingEmployee: "Missing employee",
    invalid: "Invalid shift",
    proposedOverlap: "Overlaps another copied shift",
  };

  return issues.map((issue) => labels[issue] || issue);
}

export function analyseCopyPreviousWeek({
  previousShifts = [],
  targetWeekStartKey,
  targetShifts = [],
  employees = [],
} = {}) {
  const copiedShifts = copyShiftsToWeek(previousShifts, targetWeekStartKey);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const acceptedSafeShifts = [];

  const rows = copiedShifts.map((shift, index) => {
    const issues = [];
    const employee = employeeById.get(shift.employeeId);
    const structuralValidation = validateShift(shift, {
      employees: shift.employeeId ? [{ id: shift.employeeId }] : [],
      shifts: [],
    });

    if (!employee) {
      issues.push("missingEmployee");
    } else if (employee.active === false) {
      issues.push("inactiveEmployee");
    }

    if (!structuralValidation.isValid) {
      issues.push("invalid");
    }

    if (isExactDuplicateShift(shift, targetShifts)) {
      issues.push("exactDuplicate");
    } else if (hasOverlappingShift(shift, targetShifts)) {
      issues.push("overlap");
    } else if (hasOverlappingShift(shift, acceptedSafeShifts)) {
      issues.push("proposedOverlap");
    }

    const uniqueIssues = [...new Set(issues)];
    const isSafe = uniqueIssues.length === 0;
    if (isSafe) {
      acceptedSafeShifts.push(shift);
    }

    return {
      index,
      sourceShift: previousShifts[index],
      shift,
      isSafe,
      issues: uniqueIssues,
      issueLabels: getCopyIssueLabels(uniqueIssues),
    };
  });

  const summary = rows.reduce(
    (counts, row) => {
      if (row.isSafe) counts.safe += 1;
      if (row.issues.includes("exactDuplicate")) counts.exactDuplicates += 1;
      if (row.issues.includes("overlap") || row.issues.includes("proposedOverlap")) {
        counts.overlaps += 1;
      }
      if (row.issues.includes("inactiveEmployee")) counts.inactiveEmployees += 1;
      if (row.issues.includes("missingEmployee")) counts.missingEmployees += 1;
      if (row.issues.includes("invalid")) counts.invalid += 1;
      return counts;
    },
    {
      totalPrevious: previousShifts.length,
      existingTargetShifts: targetShifts.length,
      safe: 0,
      exactDuplicates: 0,
      overlaps: 0,
      inactiveEmployees: 0,
      missingEmployees: 0,
      invalid: 0,
    }
  );

  return {
    rows,
    summary,
    safeShifts: rows.filter((row) => row.isSafe).map((row) => row.shift),
    skippedShifts: rows.filter((row) => !row.isSafe),
  };
}

function sortShiftsForDisplay(shifts = [], employees = []) {
  return [...shifts].sort((a, b) => {
    const employeeA = employees.find((employee) => employee.id === a.employeeId);
    const employeeB = employees.find((employee) => employee.id === b.employeeId);
    return `${a.date}-${a.startTime}-${employeeA?.displayName || ""}`.localeCompare(
      `${b.date}-${b.startTime}-${employeeB?.displayName || ""}`
    );
  });
}

export function formatRotaSummaryText({
  businessName = "ScheduleLoop",
  location = "",
  weekStart,
  weekDays,
  status = ROTA_STATUS.draft,
  shifts = [],
  employees = [],
  roles = [],
} = {}) {
  const days = weekDays || getWeekDays(weekStart || getWeekStartDateKey());
  const employeeNameById = new Map(
    employees.map((employee) => [employee.id, employee.displayName || "Employee"])
  );
  const roleNameById = new Map(roles.map((role) => [role.id, role.name || role.id]));
  const lines = [
    location ? `${businessName} - ${location}` : businessName,
    `Week: ${getWeekRangeLabel(days[0]?.dateKey || weekStart || getWeekStartDateKey())}`,
    `Status: ${status === ROTA_STATUS.published ? "Published" : "Draft"}`,
    "",
  ];

  if (!shifts.length) {
    lines.push("No shifts scheduled yet.");
    return lines.join("\n");
  }

  days.forEach((day) => {
    const dayShifts = sortShiftsForDisplay(
      shifts.filter((shift) => shift.date === day.dateKey),
      employees
    );

    if (!dayShifts.length) return;

    lines.push(day.label);
    dayShifts.forEach((shift) => {
      const breakLabel =
        normalizeBreakMinutes(shift.breakMinutes) > 0
          ? `, ${normalizeBreakMinutes(shift.breakMinutes)} min break`
          : "";
      lines.push(
        `- ${employeeNameById.get(shift.employeeId) || "Employee"}: ${shift.startTime}-${
          shift.endTime
        }, ${roleNameById.get(shift.roleId) || "Role"}${breakLabel}`
      );
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}
