import { calculateShiftDurationHours } from "../utils/rota";

export const TIME_OPTIONS = [
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
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
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
];

export const BREAK_OPTIONS = [0, 15, 30, 45, 60];

export function formatHours(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(2)}h`;
}

export function getRoleName(roles, roleId) {
  return roles.find((role) => role.id === roleId)?.name || "Role";
}

export function getEmployeeName(employees, employeeId) {
  return (
    employees.find((employee) => employee.id === employeeId)?.displayName ||
    "Employee"
  );
}

export function createEmptyEmployee(roles) {
  return {
    displayName: "",
    defaultRole: roles[0]?.id || "",
    hourlyRate: "",
    active: true,
  };
}

export function createEmptyShift({ employees, roles, date, employeeId = "" }) {
  const firstEmployee =
    employees.find((employee) => employee.id === employeeId) ||
    employees.find((employee) => employee.active !== false);
  const defaultRole =
    firstEmployee?.defaultRole || roles.find((role) => role.id)?.id || "";

  return {
    employeeId: firstEmployee?.id || "",
    date,
    startTime: "09:00",
    endTime: "17:00",
    roleId: defaultRole,
    breakMinutes: 0,
  };
}

export function getVisibleEmployees(employees, shifts) {
  const shiftedEmployeeIds = new Set(shifts.map((shift) => shift.employeeId));
  return employees.filter(
    (employee) => employee.active !== false || shiftedEmployeeIds.has(employee.id)
  );
}

export function getShiftHoursLabel(shift) {
  return formatHours(calculateShiftDurationHours(shift));
}
