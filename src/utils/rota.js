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

function getShiftTimeRange(shift = {}) {
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

function shiftCoversSlot(shift, slotStart, slotEnd) {
  const range = getShiftTimeRange(shift);
  if (!range) return false;
  return range.start < slotEnd && range.end > slotStart;
}

function getSlotEndTime(slotLabel, intervalMinutes) {
  const start = parseTimeToMinutes(slotLabel);
  if (start === null) return null;
  return formatMinutesAsTime(start + intervalMinutes);
}

export function calculateCoverageForDay({
  forecastPoints = [],
  shifts = [],
  roles = [],
  intervalMinutes = 60,
} = {}) {
  return forecastPoints
    .filter((point) => point?.hour)
    .map((point) => {
      const slotStart = parseTimeToMinutes(point.hour);
      const slotEnd =
        slotStart === null ? null : slotStart + Number(intervalMinutes || 60);
      const coveringShifts =
        slotEnd === null
          ? []
          : shifts.filter((shift) => shiftCoversSlot(shift, slotStart, slotEnd));
      const roleCoverage = roles.map((role) => {
        const recommended = Math.max(0, Number(point[role.id]) || 0);
        const scheduled = coveringShifts.filter(
          (shift) => shift.roleId === role.id
        ).length;
        const difference = scheduled - recommended;

        return {
          roleId: role.id,
          roleName: role.name || role.id,
          recommended,
          scheduled,
          difference,
          status:
            difference < 0 ? "under" : difference > 0 ? "over" : "matched",
        };
      });
      const recommendedTotal = Math.max(0, Number(point.total) || 0);
      const scheduledTotal = coveringShifts.length;
      const difference = scheduledTotal - recommendedTotal;

      return {
        hour: point.hour,
        endHour: getSlotEndTime(point.hour, intervalMinutes),
        recommendedTotal,
        scheduledTotal,
        difference,
        status: difference < 0 ? "under" : difference > 0 ? "over" : "matched",
        roleCoverage,
      };
    });
}

export function getCoverageSummary(coverageRows = []) {
  const totals = coverageRows.reduce(
    (summary, row) => {
      summary[row.status] += 1;
      return summary;
    },
    { under: 0, matched: 0, over: 0 }
  );

  return {
    ...totals,
    hasCoverage: coverageRows.length > 0,
  };
}

export function getCoverageWarnings(coverageRows = []) {
  return coverageRows
    .filter((row) => row.status !== "matched")
    .slice(0, 6)
    .map((row) => {
      const amount = Math.abs(row.difference);
      const staffLabel = amount === 1 ? "1 person" : `${amount} people`;
      const direction =
        row.status === "under" ? "fewer than recommended" : "more than recommended";

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
