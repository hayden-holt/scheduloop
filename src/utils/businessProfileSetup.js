import {
  getBusinessPresetRoles,
  normalizeRolesForAccuracy,
} from "../config/businessPresets.js";
import { HOURS, getWeekdayFromDateKey } from "./schedule.js";
import { normalizePositiveNumber, normalizeStaffCount } from "./staffing.js";

export const BUSINESS_SUBTYPES = {
  retail: [
    { value: "retailStore", label: "Retail store / shop" },
    { value: "otherBusiness", label: "Other staff-based business" },
  ],
  cafe: [
    { value: "coffeeShop", label: "Coffee shop" },
    { value: "takeaway", label: "Takeaway" },
    { value: "casualDining", label: "Casual dining" },
    { value: "fullServiceRestaurant", label: "Full-service restaurant" },
    { value: "bakeryCafe", label: "Bakery / cafe" },
  ],
  gym: [
    { value: "commercialGym", label: "Commercial gym" },
    { value: "boutiqueStudio", label: "Boutique studio" },
    { value: "ptStudio", label: "PT studio" },
    { value: "classBasedStudio", label: "Class-based studio" },
    { value: "leisureCentre", label: "Leisure centre" },
  ],
};

export const CUSTOMER_PATTERN_OPTIONS = [
  { value: "steady", label: "Steady throughout the day" },
  { value: "morningRush", label: "Morning rush" },
  { value: "lunchRush", label: "Lunch rush" },
  { value: "eveningRush", label: "Evening rush" },
  { value: "weekendHeavy", label: "Weekend-heavy" },
  { value: "classBased", label: "Class / session based" },
];

export const BUSINESS_RHYTHM_OPTIONS = [
  { value: "morning", label: "Morning" },
  { value: "lunch", label: "Lunch" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "weekends", label: "Weekends" },
  { value: "eventClass", label: "Event / class times" },
  { value: "notSure", label: "Not sure yet" },
];

const RHYTHM_BY_PATTERN = {
  morningRush: "morning",
  lunchRush: "lunch",
  eveningRush: "evening",
  weekendHeavy: "weekends",
  classBased: "eventClass",
  steady: "notSure",
};

export function getBusinessRhythmForCustomerPattern(customerPattern) {
  return RHYTHM_BY_PATTERN[customerPattern] || "notSure";
}

const DEMAND_UNITS = {
  retail: [
    { value: "customers", label: "Customers" },
    { value: "transactions", label: "Transactions" },
    { value: "bookings", label: "Bookings / appointments" },
  ],
  cafe: [
    { value: "orders", label: "Orders" },
    { value: "covers", label: "Covers" },
  ],
  gym: [
    { value: "checkIns", label: "Check-ins" },
    { value: "bookings", label: "Bookings" },
  ],
};

const ROLE_DESCRIPTIONS = {
  teamMember: "Serves customers and handles day-to-day tasks.",
  barista: "Handles drinks, counter service, and quick customer flow.",
  kitchen: "Prepares food and keeps service moving during peaks.",
  wait: "Looks after tables, floor service, and customer handover.",
  manager: "Keeps the shift coordinated and handles issues.",
  frontDesk: "Covers reception, check-ins, enquiries, and member support.",
  pts: "Supports PT bookings, consultations, and gym floor coaching.",
  classes: "Runs scheduled classes or sessions.",
  cleanerFloor: "Keeps the space safe, tidy, and ready for customers.",
};

const DEFAULT_ROLE_COLORS = {
  manager: "#facc15",
  cleanerFloor: "#a855f7",
};

const DEFAULT_PEAK_STAFF_BY_PROFILE = {
  retail: {
    default: { teamMember: 2, manager: 1 },
  },
  cafe: {
    default: { barista: 2, kitchen: 1, wait: 1 },
    coffeeShop: { barista: 3, kitchen: 1, wait: 1 },
    takeaway: { barista: 2, kitchen: 2, wait: 0 },
    casualDining: { barista: 2, kitchen: 3, wait: 3, manager: 1 },
    fullServiceRestaurant: { barista: 2, kitchen: 3, wait: 4, manager: 1 },
    bakeryCafe: { barista: 3, kitchen: 2, wait: 1, manager: 1 },
  },
  gym: {
    default: { frontDesk: 1, pts: 1, classes: 1 },
    commercialGym: { frontDesk: 2, pts: 2, classes: 1, cleanerFloor: 1 },
    boutiqueStudio: { frontDesk: 1, pts: 2, classes: 2 },
    ptStudio: { frontDesk: 1, pts: 3, classes: 0 },
    classBasedStudio: { frontDesk: 1, pts: 1, classes: 2 },
    leisureCentre: { frontDesk: 2, pts: 2, classes: 2, cleanerFloor: 2 },
  },
};

function createRole({
  id,
  name,
  description,
  color,
  serviceRate,
  minStaff,
  demandWeight,
  requiredDuringOpen,
  preferredDemandSource,
}) {
  return {
    id,
    name,
    description,
    color,
    curve: Array(HOURS.length).fill(1),
    serviceRate,
    minStaff,
    maxStaff: 0,
    demandWeight,
    demandShare: 1,
    requiredDuringOpen,
    preferredDemandSource,
    hourlyWage: null,
  };
}

function withPeakDefaults(roles, businessType, businessSubtype) {
  const profileDefaults = DEFAULT_PEAK_STAFF_BY_PROFILE[businessType] || {};
  const defaults = {
    ...(profileDefaults.default || {}),
    ...(profileDefaults[businessSubtype] || {}),
  };

  return roles.map((role) => ({
    ...role,
    defaultPeakStaff: normalizeStaffCount(
      defaults[role.id] ?? role.defaultPeakStaff ?? role.minStaff ?? 1
    ),
  }));
}

export function getBusinessSubtypeOptions(businessType) {
  return BUSINESS_SUBTYPES[businessType] || BUSINESS_SUBTYPES.gym;
}

export function getDefaultBusinessSubtype(businessType) {
  return getBusinessSubtypeOptions(businessType)[0]?.value || "";
}

export function getDemandUnitOptions(businessType) {
  return DEMAND_UNITS[businessType] || DEMAND_UNITS.gym;
}

export function getDemandUnitLabel(businessType, unit) {
  const options = getDemandUnitOptions(businessType);
  return options.find((option) => option.value === unit)?.label || options[0].label;
}

export function normalizeBusinessProfileBasics(profile = {}) {
  // Keep legacy gym profiles and the existing fallback while accepting retail.
  const businessType = ["cafe", "gym", "retail"].includes(profile.businessType)
    ? profile.businessType
    : "gym";
  const subtypeOptions = getBusinessSubtypeOptions(businessType);
  const businessSubtype = subtypeOptions.some(
    (option) => option.value === profile.businessSubtype
  )
    ? profile.businessSubtype
    : getDefaultBusinessSubtype(businessType);
  const customerPattern = CUSTOMER_PATTERN_OPTIONS.some(
    (option) => option.value === profile.customerPattern
  )
    ? profile.customerPattern
    : "steady";
  const businessRhythm = BUSINESS_RHYTHM_OPTIONS.some(
    (option) => option.value === profile.businessRhythm
  )
    ? profile.businessRhythm
    : RHYTHM_BY_PATTERN[customerPattern] || "notSure";

  return {
    businessName: String(profile.businessName || "").trim() || "My business",
    businessType,
    businessSubtype,
    location: String(profile.location || "").trim(),
    customerPattern,
    businessRhythm,
  };
}

export function normalizeDemandEstimates(estimates, businessType) {
  const defaultUnit = getDemandUnitOptions(businessType)[0].value;
  const source =
    estimates && typeof estimates === "object" && !Array.isArray(estimates)
      ? estimates
      : {};
  const unit = getDemandUnitOptions(businessType).some(
    (option) => option.value === source.unit
  )
    ? source.unit
    : defaultUnit;

  return {
    unit,
    quiet: normalizeOptionalDemandValue(source.quiet),
    normal: normalizeOptionalDemandValue(source.normal),
    busy: normalizeOptionalDemandValue(source.busy),
  };
}

function normalizeOptionalDemandValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  return normalizePositiveNumber(value, null);
}

export function deriveBusyLevelFromDemandEstimates(estimates, fallback = "normal") {
  const normal = Number(estimates?.normal);
  const busy = Number(estimates?.busy);

  if (!Number.isFinite(normal) || normal <= 0) return fallback;
  if (Number.isFinite(busy) && busy >= normal * 1.5) return "busy";
  return fallback;
}

function roleWithDescription(role) {
  return {
    ...role,
    description: role.description || ROLE_DESCRIPTIONS[role.id] || "",
  };
}

function addRoleIfMissing(roles, role) {
  if (roles.some((item) => item.id === role.id)) return roles;
  return [...roles, role];
}

export function getDefaultRolesForBusinessProfile({
  businessType = "gym",
  businessSubtype = "",
} = {}) {
  let roles = getBusinessPresetRoles(businessType).map(roleWithDescription);

  if (businessType === "cafe") {
    roles = roles.map((role) => {
      if (role.id === "barista" && businessSubtype !== "fullServiceRestaurant") {
        return { ...role, name: "Barista / Front of House" };
      }
      if (role.id === "wait" && businessSubtype === "takeaway") {
        return { ...role, minStaff: 0, requiredDuringOpen: false };
      }
      return role;
    });

    if (
      businessSubtype === "casualDining" ||
      businessSubtype === "fullServiceRestaurant" ||
      businessSubtype === "bakeryCafe"
    ) {
      roles = addRoleIfMissing(
        roles,
        createRole({
          id: "manager",
          name: "Manager",
          description: ROLE_DESCRIPTIONS.manager,
          color: DEFAULT_ROLE_COLORS.manager,
          serviceRate: 60,
          minStaff: 0,
          demandWeight: 0.25,
          requiredDuringOpen: false,
          preferredDemandSource: "customers",
        })
      );
    }
  } else if (businessType === "gym") {
    roles = roles.map((role) => {
      if (role.id === "classes" && businessSubtype === "ptStudio") {
        return { ...role, minStaff: 0, requiredDuringOpen: false };
      }
      if (role.id === "pts" && businessSubtype === "classBasedStudio") {
        return { ...role, minStaff: 0, demandWeight: 0.2 };
      }
      return role;
    });

    if (businessSubtype === "commercialGym" || businessSubtype === "leisureCentre") {
      roles = addRoleIfMissing(
        roles,
        createRole({
          id: "cleanerFloor",
          name: "Cleaner / Floor Staff",
          description: ROLE_DESCRIPTIONS.cleanerFloor,
          color: DEFAULT_ROLE_COLORS.cleanerFloor,
          serviceRate: 50,
          minStaff: 0,
          demandWeight: 0.2,
          requiredDuringOpen: false,
          preferredDemandSource: "visits",
        })
      );
    }
  }

  return withPeakDefaults(
    normalizeRolesForAccuracy(roles).map(roleWithDescription),
    businessType,
    businessSubtype
  );
}

export function applyBusinessRhythmToRoles(roles = [], rhythm = "notSure") {
  return normalizeRolesForAccuracy(roles).map((role) => ({
    ...role,
    curve: applyBusinessRhythmToCurve(role.curve, rhythm),
  }));
}

export function applyBusinessRhythmToCurve(curve = [], rhythm = "notSure") {
  const ranges = {
    morning: ["07:00", "10:00"],
    lunch: ["11:00", "14:00"],
    afternoon: ["14:00", "17:00"],
    evening: ["17:00", "21:00"],
    weekends: ["10:00", "15:00"],
    eventClass: ["06:00", "20:00"],
  };
  const safeCurve = normalizeRolesForAccuracy([{ id: "temp", curve }])[0].curve;
  const range = ranges[rhythm];

  if (!range) return safeCurve;

  return safeCurve.map((value, index) => {
    const hour = HOURS[index];
    let multiplier = hour >= range[0] && hour <= range[1] ? 1.18 : 1;

    if (rhythm === "eventClass") {
      multiplier =
        hour === "06:00" || hour === "12:00" || hour === "18:00" ? 1.22 : 1;
    }

    return Math.round(value * multiplier * 100) / 100;
  });
}

export function buildPeakStaffDefaults(roles = [], existingPeakStaff = {}) {
  return Object.fromEntries(
    roles.map((role) => [
      role.id,
      normalizeStaffCount(existingPeakStaff[role.id] ?? role.defaultPeakStaff ?? 1),
    ])
  );
}

export function normalizeOpeningHours(hours = {}) {
  const open = HOURS.includes(hours.open) ? hours.open : "09:00";
  const close = HOURS.includes(hours.close) ? hours.close : "17:00";
  const weekend = hours.weekend || {};
  const weekendOpen = HOURS.includes(weekend.open) ? weekend.open : open;
  const weekendClose = HOURS.includes(weekend.close) ? weekend.close : close;

  return {
    open,
    close,
    hoursList: HOURS,
    weekend: {
      enabled: weekend.enabled === true,
      open: weekendOpen,
      close: weekendClose,
    },
  };
}

export function getOpeningHoursForDate(hours = {}, dateKey) {
  const normalized = normalizeOpeningHours(hours);

  if (!normalized.weekend.enabled || !dateKey) {
    return { open: normalized.open, close: normalized.close };
  }

  const weekday = getWeekdayFromDateKey(dateKey);
  if (weekday === 0 || weekday === 6) {
    return {
      open: normalized.weekend.open,
      close: normalized.weekend.close,
    };
  }

  return { open: normalized.open, close: normalized.close };
}
