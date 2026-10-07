import { HOURS } from "../utils/schedule.js";

const LEGACY_HOURS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

export const DEFAULT_OPERATING_RULES = {
  intervalMinutes: 30,
  demandBufferPercent: 10,
  minTotalStaff: 1,
  prepMinutes: 30,
  closeMinutes: 30,
  breakAllowancePercent: 5,
};

export const BUSINESS_ROLE_PRESETS = {
  retail: [
    {
      id: "teamMember",
      name: "Team Member",
      color: "#4f8cff",
      curve: Array(HOURS.length).fill(1),
      serviceRate: 20,
      minStaff: 1,
      demandWeight: 1,
      preferredDemandSource: "customers",
      requiredDuringOpen: true,
    },
    {
      id: "manager",
      name: "Manager / Supervisor",
      color: "#facc15",
      curve: Array(HOURS.length).fill(1),
      serviceRate: 60,
      minStaff: 0,
      demandWeight: 0.25,
      preferredDemandSource: "customers",
      requiredDuringOpen: false,
    },
  ],
  gym: [
    {
      id: "frontDesk",
      name: "Front Desk",
      color: "#4f8cff",
      curve: [1, 1, 2, 3, 4, 3, 2, 2, 3, 4],
      serviceRate: 40,
      minStaff: 1,
      demandWeight: 1,
      preferredDemandSource: "visits",
      requiredDuringOpen: true,
    },
    {
      id: "pts",
      name: "PTs",
      color: "#3bd68b",
      curve: [0, 1, 2, 3, 3, 3, 2, 2, 3, 3],
      serviceRate: 8,
      minStaff: 0,
      demandWeight: 0.35,
      preferredDemandSource: "ptBookings",
      requiredDuringOpen: false,
    },
    {
      id: "classes",
      name: "Class Instructors",
      color: "#ff776f",
      curve: [0, 0, 1, 2, 3, 2, 1, 1, 2, 2],
      serviceRate: 20,
      minStaff: 0,
      demandWeight: 0.25,
      preferredDemandSource: "classBookings",
      requiredDuringOpen: false,
    },
  ],
  cafe: [
    {
      id: "barista",
      name: "Barista",
      color: "#4f8cff",
      curve: [1, 2, 3, 4, 4, 3, 2, 2, 2, 2],
      serviceRate: 25,
      minStaff: 1,
      demandWeight: 1,
      preferredDemandSource: "drinkOrders",
      requiredDuringOpen: true,
    },
    {
      id: "kitchen",
      name: "Kitchen",
      color: "#ff776f",
      curve: [1, 1, 2, 3, 4, 3, 2, 1, 1, 1],
      serviceRate: 18,
      minStaff: 1,
      demandWeight: 0.7,
      preferredDemandSource: "foodOrders",
      requiredDuringOpen: true,
    },
    {
      id: "wait",
      name: "Wait Staff",
      color: "#3bd68b",
      curve: [0, 1, 2, 3, 3, 3, 2, 2, 2, 2],
      serviceRate: 30,
      minStaff: 1,
      demandWeight: 1,
      preferredDemandSource: "customers",
      requiredDuringOpen: true,
    },
  ],
};

export function normalizeRoleCurve(curve) {
  const values = Array.isArray(curve) ? curve : [];
  const fallback = values.length > 0 ? values : Array(LEGACY_HOURS.length).fill(1);

  if (fallback.length === HOURS.length) {
    return fallback.map((value) => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? num : 0;
    });
  }

  return HOURS.map((hour) => {
    const legacyIndex = LEGACY_HOURS.indexOf(hour);
    const sourceIndex =
      legacyIndex !== -1
        ? legacyIndex
        : hour < LEGACY_HOURS[0]
          ? 0
          : LEGACY_HOURS.length - 1;
    const num = Number(fallback[sourceIndex]);
    const safeValue = Number.isFinite(num) && num >= 0 ? num : 0;

    if (legacyIndex !== -1) return safeValue;
    return Math.round(safeValue * 0.55 * 100) / 100;
  });
}

export function withRoleAccuracyDefaults(role) {
  const withDefaults = {
    serviceRate: 20,
    minStaff: 0,
    maxStaff: 0,
    demandWeight: 1,
    demandShare: 1,
    preferredDemandSource: "",
    requiredDuringOpen: false,
    hourlyWage: null,
    ...role,
  };

  return {
    ...withDefaults,
    curve: normalizeRoleCurve(withDefaults.curve),
  };
}

export function normalizeRolesForAccuracy(roles) {
  return roles.map(withRoleAccuracyDefaults);
}

export function getBusinessPresetRoles(businessType) {
  return normalizeRolesForAccuracy(
    BUSINESS_ROLE_PRESETS[businessType] || BUSINESS_ROLE_PRESETS.gym
  );
}

export function normalizeOperatingRules(rules) {
  return {
    ...DEFAULT_OPERATING_RULES,
    ...(rules || {}),
  };
}
