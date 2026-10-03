import { addDaysToDateKey, calculateShiftCost } from "../utils/rota.js";
import { parseLocalDateKey, toLocalDateKey } from "../utils/schedule.js";

export const ROTA_VIEW_KEY = "scheduleloop.rotaView";

export function readRotaView(storage) {
  try {
    return storage?.getItem(ROTA_VIEW_KEY) === "month" ? "month" : "week";
  } catch {
    return "week";
  }
}

export function moveRotaDate(dateKey, view, direction) {
  if (view === "week") return addDaysToDateKey(dateKey, direction * 7);
  const date = parseLocalDateKey(dateKey);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + direction);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  date.setDate(Math.min(day, lastDay));
  return toLocalDateKey(date);
}

export function getRotaMonth(dateKey) {
  const date = parseLocalDateKey(dateKey);
  date.setDate(1);
  const start = toLocalDateKey(date);
  const leadingDays = (date.getDay() + 6) % 7;
  const label = date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const length = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const days = Array.from({ length }, (_, index) => ({
    dateKey: addDaysToDateKey(start, index),
    day: index + 1,
  }));
  return {
    start,
    end: addDaysToDateKey(start, length),
    leadingDays,
    label,
    days,
  };
}

export function summarizeRotaDay({
  shifts = [],
  employees,
  roles,
  averageHourlyWage,
}) {
  const costs = shifts.map((shift) =>
    calculateShiftCost({ shift, employees, roles, averageHourlyWage })
  );
  return {
    staffCount: new Set(shifts.map((shift) => shift.employeeId).filter(Boolean))
      .size,
    shiftCount: shifts.length,
    // A partial wage total must not look like a complete daily estimate.
    labourCost: costs.some((cost) => cost === null)
      ? null
      : Math.round(costs.reduce((total, cost) => total + cost, 0) * 100) / 100,
  };
}
