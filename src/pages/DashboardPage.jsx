import { useMemo, useState } from "react";
import ShapeOfDayChart from "../components/ShapeOfDayChart";
import InfoCard from "../components/InfoCard";
import CalendarPanel from "../components/CalendarPanel";
import StaffBreakdownPanel from "../components/StaffBreakdownPanel";
import AccuracySettingsPanel from "../components/AccuracySettingsPanel";
import RotaGuidancePanel from "../components/RotaGuidancePanel";
import ForecastFeedbackPanel from "../components/ForecastFeedbackPanel";
import { useAuth } from "../auth/AuthContext";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import { useTheme } from "../theme/ThemeContext";
import {
  getBusinessPresetRoles,
  normalizeOperatingRules,
  normalizeRolesForAccuracy,
} from "../config/businessPresets";
import {
  getCoverageWindowFlags,
  getHourIndexForSlot,
  getStaffingCoverageSlotWindow,
  getWeekdayFromDateKey,
  holidayDateKey,
  HOURS,
  parseLocalDateKey,
  toLocalDateKey,
} from "../utils/schedule";
import { assertCsvFileIsSafe, parseCsvDemand } from "../utils/csvDemand";
import {
  applyMinimumTotalStaff,
  calculateBacktestSummary,
  calculateRoleStaff,
  normalizeStaffCount,
  runForecastBacktest,
  stabilizeStaffingRecommendations,
} from "../utils/staffing";
import {
  getCsvBlendWeight,
  getCsvDemandUnitsForRole,
  getDemandConfidence,
  hasRoleSpecificDemandForRoles,
  isCurrentCsvDemandModel,
} from "../utils/demandModel";
import {
  calculateLabourCostEstimate,
  formatCurrencyGBP,
  getLabourCostDetail,
} from "../utils/labourCost";
import { calculateRotaGuidance } from "../utils/rotaGuidance";
import {
  getOpeningHoursForDate,
  normalizeOpeningHours,
} from "../utils/businessProfileSetup";
import {
  getAverageFeedbackCorrection,
  getStaffingFeedback,
  saveStaffingFeedback,
  TOTAL_FEEDBACK_ROLE_ID,
} from "../utils/staffingFeedback";
import {
  calculateContextMultiplier,
  getContextAdjustmentSummary,
  hasActiveDayContext,
  normaliseDayConfigs,
  normaliseDayContext,
} from "../utils/dayContext";

const DAY_TYPE_SCALE = {
  quiet: 0.8,
  normal: 1.0,
  busy: 1.2,
  event: 1.4,
};

const BUSY_SCALE = {
  quiet: 0.7,
  normal: 1.0,
  busy: 1.3,
  veryBusy: 1.6,
};

const HOLIDAY_DEFINITIONS = [
  { month: 0, day: 1, label: "New Year's Day" },
  { month: 11, day: 25, label: "Christmas Day" },
  { month: 11, day: 26, label: "Boxing Day" },
];

function buildInitialDayConfigs() {
  const base = {};
  const currentYear = new Date().getFullYear();

  [currentYear, currentYear + 1].forEach((year) => {
    HOLIDAY_DEFINITIONS.forEach(({ month, day, label }) => {
      base[holidayDateKey(year, month, day)] = {
        dayType: "event",
        note: label,
      };
    });
  });

  return base;
}

function getInitialRoles(profile) {
  if (profile?.roles && profile.roles.length > 0) {
    return normalizeRolesForAccuracy(profile.roles);
  }
  return getBusinessPresetRoles(profile?.businessType || "gym");
}

function getInitialDayConfigs(profile) {
  return normaliseDayConfigs(profile?.dayConfigs || buildInitialDayConfigs());
}

function getBusinessTypeLabel(businessType) {
  if (businessType === "gym") return "Gym / Fitness";
  if (businessType === "cafe") return "Cafe / Restaurant";
  return businessType;
}

function getDayTypeLabel(dayType) {
  if (dayType === "quiet") return "Quiet day";
  if (dayType === "busy") return "Busy day";
  if (dayType === "event") return "Event day";
  return "Normal day";
}

function getFriendlyConfidence(confidence) {
  if (confidence.label === "Preset") {
    return {
      value: "Starter estimate",
      detail:
        "Based on your business setup and operating patterns until trading history is uploaded.",
    };
  }

  return {
    value: confidence.label,
    detail: confidence.detail,
  };
}

function parseSelectedDateLabel(dateKey) {
  return parseLocalDateKey(dateKey).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatStaffHours(hours) {
  const rounded = Math.round((Number(hours) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatPercentChange(percent) {
  const rounded = Math.round(Number(percent) || 0);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
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

function MetricIcon({ name }) {
  const icons = {
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="9" r="3" />
        <circle cx="16" cy="10" r="2.5" />
        <path d="M4 19c.7-3 2.4-5 5-5s4.3 2 5 5" />
        <path d="M13.5 15.3c2 .4 3.2 1.8 3.8 3.7" />
      </>
    ),
    trend: (
      <>
        <path d="M4 16l5-5 4 3 6-7" />
        <path d="M15 7h4v4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 4l7 3v5c0 4-2.8 6.8-7 8-4.2-1.2-7-4-7-8V7l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    document: (
      <>
        <path d="M7 4h7l4 4v12H7z" />
        <path d="M14 4v5h4" />
        <path d="M9.5 13h5" />
        <path d="M9.5 16h4" />
      </>
    ),
    money: (
      <>
        <path d="M7 7h10a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h10" />
        <path d="M12 4v16" />
      </>
    ),
  };

  return (
    <svg
      className="planner-metric-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
      {icons[name]}
    </svg>
  );
}

function PlannerMetricCard({
  label,
  value,
  detail,
  tone = "default",
  icon,
  featured = false,
}) {
  return (
    <article
      className={
        `planner-metric-card planner-metric-${tone}` +
        (featured ? " planner-metric-featured" : "")
      }
    >
      <div className="planner-metric-topline">
        <span className="planner-metric-label">{label}</span>
        {icon && <MetricIcon name={icon} />}
      </div>
      <strong className="planner-metric-value">{value}</strong>
      {detail && <p className="planner-metric-detail">{detail}</p>}
    </article>
  );
}

function DashboardPage() {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { profile, saveProfile, saveCsvDemand } = useBusinessProfile();
  const storedCsvDemand = isCurrentCsvDemandModel(profile?.csvDemand)
    ? profile.csvDemand
    : null;
  const hasOutdatedCsvDemand = Boolean(profile?.csvDemand && !storedCsvDemand);

  const [businessType, setBusinessType] = useState(
    profile?.businessType || "gym"
  );
  const [roles, setRoles] = useState(() => getInitialRoles(profile));
  const [operatingRules, setOperatingRules] = useState(() =>
    normalizeOperatingRules(profile?.operatingRules)
  );
  const [busyLevel] = useState(profile?.busyLevel || "normal");
  const [peakStaff, setPeakStaff] = useState(profile?.peakStaff || {});
  const [selectedDate, setSelectedDate] = useState(() =>
    toLocalDateKey(new Date())
  );
  const profileHours = useMemo(
    () => normalizeOpeningHours(profile?.hours),
    [profile?.hours]
  );
  const openingHours = useMemo(
    () => getOpeningHoursForDate(profileHours, selectedDate),
    [profileHours, selectedDate]
  );
  const [dayConfigs, setDayConfigs] = useState(() =>
    getInitialDayConfigs(profile)
  );
  const [staffingFeedback, setStaffingFeedback] = useState(() =>
    getStaffingFeedback(profile)
  );
  const [csvCurves, setCsvCurves] = useState(storedCsvDemand);
  const [uploadError, setUploadError] = useState(() =>
    hasOutdatedCsvDemand
      ? "Re-upload your CSV so the improved demand model can rebuild this profile."
      : ""
  );
  const [uploadInfo, setUploadInfo] = useState(() =>
    storedCsvDemand ? { ...storedCsvDemand } : null
  );
  const [dashboardError, setDashboardError] = useState("");
  const [activeView, setActiveView] = useState("planner");

  const hasCsv = !!(csvCurves && csvCurves.rows > 0);
  const busyScale = hasCsv ? 1 : BUSY_SCALE[busyLevel] ?? 1.0;
  const currentDayConfig = dayConfigs[selectedDate] || {};
  const dayType = currentDayConfig?.dayType || "normal";
  const dayScale = DAY_TYPE_SCALE[dayType] ?? 1.0;
  const selectedDayContext = normaliseDayContext(currentDayConfig.context);
  const hasSelectedContext = hasActiveDayContext(selectedDayContext);
  const contextSummary = getContextAdjustmentSummary(selectedDayContext);

  const persistProfilePatch = async (patch) => {
    try {
      await saveProfile(patch);
      setDashboardError("");
    } catch (err) {
      console.error(err);
      setDashboardError("Your latest change could not be saved.");
    }
  };

  const handleBusinessTypeChange = (e) => {
    const nextType = e.target.value;
    setBusinessType(nextType);
    persistProfilePatch({ businessType: nextType });
  };

  const handleCsvChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setUploadInfo(null);

    try {
      assertCsvFileIsSafe(file);
    } catch (err) {
      setUploadError(err.message || "CSV file cannot be uploaded.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const demandModel = parseCsvDemand(event.target.result, {
          openingHours,
          intervalMinutes: operatingRules.intervalMinutes,
        });
        await saveCsvDemand(demandModel);
        setCsvCurves(demandModel);
        setUploadInfo(demandModel);
        setUploadError("");
      } catch (err) {
        console.error(err);
        setUploadError(err.message || "Failed to read CSV file.");
        setCsvCurves(null);
      }
    };

    reader.onerror = () => {
      setUploadError("Error reading the file.");
      setCsvCurves(null);
    };

    reader.readAsText(file);
  };

  const presetShape = useMemo(() => {
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
  }, [roles]);

  const chartData = useMemo(() => {
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
      getStaffingCoverageSlotWindow(
        openingHours,
        operatingRules
      );
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

    const rawStaffingPoints = slotLabels.map((slotLabel, slotIndex) => {
      const absoluteIndex = getHourIndexForSlot(slotLabel);
      const point = { hour: slotLabel };
      const isTradingSlot = tradingSlotSet.has(slotLabel);
      const preset = isTradingSlot ? presetShape[absoluteIndex] ?? 0 : 0;
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
  }, [
    roles,
    peakStaff,
    openingHours,
    operatingRules,
    selectedDate,
    dayConfigs,
    busyScale,
    dayScale,
    hasCsv,
    csvCurves,
    presetShape,
    staffingFeedback,
  ]);

  const totalStaffHours = useMemo(
    () =>
      chartData.reduce(
        (sum, point) =>
          sum + (point.total || 0) * (operatingRules.intervalMinutes / 60),
        0
      ),
    [chartData, operatingRules.intervalMinutes]
  );
  const labourCostEstimate = useMemo(
    () =>
      calculateLabourCostEstimate({
        chartData,
        roles,
        intervalMinutes: operatingRules.intervalMinutes,
        averageHourlyWage: operatingRules.averageHourlyWage,
      }),
    [
      chartData,
      roles,
      operatingRules.intervalMinutes,
      operatingRules.averageHourlyWage,
    ]
  );
  const rotaGuidance = useMemo(
    () =>
      calculateRotaGuidance({
        chartData,
        roles,
        intervalMinutes: operatingRules.intervalMinutes,
        minTotalStaff: operatingRules.minTotalStaff,
      }),
    [chartData, roles, operatingRules.intervalMinutes, operatingRules.minTotalStaff]
  );

  const selectedWeekday = getWeekdayFromDateKey(selectedDate);
  const hasRoleSpecificDemand = useMemo(
    () => hasRoleSpecificDemandForRoles(csvCurves, roles),
    [csvCurves, roles]
  );
  const demandConfidence = getDemandConfidence(
    csvCurves ? { ...csvCurves, hasRoleSpecificDemand } : csvCurves,
    selectedWeekday,
    {
      hasManagerFeedback: staffingFeedback.length > 0,
      hasDayContext: hasSelectedContext,
    }
  );
  const backtestSummary = calculateBacktestSummary(
    chartData,
    csvCurves,
    selectedWeekday
  );
  const forecastBacktest = useMemo(
    () =>
      runForecastBacktest({
        historicalData: csvCurves,
        roles,
        businessProfile: { operatingRules, peakStaff },
      }),
    [csvCurves, roles, operatingRules, peakStaff]
  );

  const peakDemandSummary = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { value: "No data", detail: "" };
    }

    const numericDemandUnits = chartData
      .map((point) => point.demandUnits)
      .filter((value) => typeof value === "number" && value > 0);

    if (numericDemandUnits.length > 0) {
      const maxUnits = Math.max(...numericDemandUnits);
      const metric = csvCurves?.demandMetric;
      const isMoney = metric?.type === "money";

      return {
        value: isMoney
          ? `GBP ${Math.round(maxUnits).toLocaleString()}`
          : Math.round(maxUnits).toLocaleString(),
        detail: metric?.column
          ? `Highest forecast block from ${metric.column}.`
          : "Highest forecast block from uploaded data.",
      };
    }

    const maxDemandScore = Math.max(
      ...chartData.map((point) => point.demandScore || 0)
    );

    return {
      value: `${Math.round(maxDemandScore * 100)}%`,
      detail: hasCsv
        ? "Relative to the busiest uploaded pattern."
        : "Relative to your business profile.",
    };
  }, [chartData, csvCurves, hasCsv]);

  const friendlyConfidence = getFriendlyConfidence(demandConfidence);
  const confidenceLabel = demandConfidence.score
    ? `${friendlyConfidence.value} (${demandConfidence.score}/100)`
    : friendlyConfidence.value;
  const selectedDateLabel = parseSelectedDateLabel(selectedDate);
  const staffHoursLabel = formatStaffHours(totalStaffHours);
  const labourCostLabel = labourCostEstimate.hasWage
    ? formatCurrencyGBP(labourCostEstimate.estimatedCost)
    : "Add wage";
  const labourCostDetail = getLabourCostDetail(labourCostEstimate);
  const forecastBasis = hasCsv
    ? `Uploaded ${csvCurves.rows.toLocaleString()} rows across ${
        csvCurves.observedDays || "several"
      } observed days${
        hasRoleSpecificDemand ? ", including role-specific demand." : "."
      }`
    : "No trading history uploaded yet. This forecast is based on your business setup and operating patterns.";

  const handleDayConfigChange = (date, partialConfig) => {
    const nextConfig = {
      ...(dayConfigs[date] || {}),
      ...partialConfig,
    };

    if (Object.prototype.hasOwnProperty.call(partialConfig, "context")) {
      nextConfig.context = normaliseDayContext(partialConfig.context);
    }

    const nextConfigs = {
      ...dayConfigs,
      [date]: nextConfig,
    };
    const normalisedConfigs = normaliseDayConfigs(nextConfigs);

    setDayConfigs(normalisedConfigs);
    persistProfilePatch({ dayConfigs: normalisedConfigs });
  };

  const handleStaffingChange = (nextRoles, nextPeakStaff) => {
    setRoles(nextRoles);
    setPeakStaff(nextPeakStaff);
    persistProfilePatch({ roles: nextRoles, peakStaff: nextPeakStaff });
  };

  const handleOperatingRulesChange = (nextRules) => {
    const normalizedRules = normalizeOperatingRules(nextRules);
    setOperatingRules(normalizedRules);
    persistProfilePatch({ operatingRules: normalizedRules });
  };

  const handleFeedbackSave = async (feedback) => {
    const previousFeedback = staffingFeedback;
    const nextFeedback = saveStaffingFeedback(staffingFeedback, feedback);
    setStaffingFeedback(nextFeedback);

    try {
      await saveProfile({ staffingFeedback: nextFeedback });
      setDashboardError("");
    } catch (err) {
      console.error(err);
      setStaffingFeedback(previousFeedback);
      setDashboardError("Your forecast feedback could not be saved.");
    }
  };

  const peakHoursLabel = useMemo(() => {
    if (!chartData || chartData.length === 0) return "No data for today";

    const totals = chartData.map((point) => point.total || 0);
    const maxTotal = Math.max(...totals);
    if (maxTotal <= 0) return "No clear peaks";

    const threshold = maxTotal * 0.8;
    const ranges = [];
    let currentStart = null;
    let currentEnd = null;

    chartData.forEach((point) => {
      const isPeak = (point.total || 0) >= threshold;

      if (isPeak) {
        if (currentStart === null) {
          currentStart = point.hour;
        }
        currentEnd = point.hour;
      } else if (currentStart !== null) {
        ranges.push({ start: currentStart, end: currentEnd });
        currentStart = null;
        currentEnd = null;
      }
    });

    if (currentStart !== null) {
      ranges.push({ start: currentStart, end: currentEnd });
    }

    if (ranges.length === 0) return "No clear peaks";

    return ranges
      .map((range) =>
        range.start === range.end ? range.start : `${range.start}-${range.end}`
      )
      .join(" / ");
  }, [chartData]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Scheduloop</h1>
          <p className="subtitle">
            A daily staffing plan shaped around demand, roles, and local
            context.
          </p>

          <p className="business-type-label">
            Profile for: <strong>{getBusinessTypeLabel(businessType)}</strong>
          </p>
        </div>

        <div className="header-controls">
          <div className="view-tabs" role="tablist" aria-label="Dashboard views">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "planner"}
              className={
                "view-tab" + (activeView === "planner" ? " active" : "")
              }
              onClick={() => setActiveView("planner")}
            >
              Planner View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "setup"}
              className={"view-tab" + (activeView === "setup" ? " active" : "")}
              onClick={() => setActiveView("setup")}
            >
              Setup View
            </button>
          </div>
          <div className="date-pill">
            {selectedDate} /{" "}
            {hasCsv ? "Based on uploaded data" : "Based on your business profile"} /{" "}
            {getDayTypeLabel(dayType)}
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "Dark" : "Light"}
          </button>
          <button className="logout-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {dashboardError && (
        <div className="banner banner-error">{dashboardError}</div>
      )}

      {activeView === "planner" ? (
        <main className="planner-view">
          <section className="planner-heading">
            <div>
              <p className="section-kicker">Planner View</p>
              <h2>Today&apos;s staffing plan</h2>
              <p>
                {selectedDateLabel} is set as a{" "}
                {getDayTypeLabel(dayType).toLowerCase()}. Use this as guidance,
                then add the business context only you know.
              </p>
            </div>
          </section>

          <section className="planner-recommendation-panel">
            <div className="planner-recommendation-copy">
              <span className="planner-recommendation-label">
                Key recommendation
              </span>
              <h3>
                Plan for {staffHoursLabel} staff hours today.
              </h3>
              <p>
                Strongest cover is expected around {peakHoursLabel}. Use this as
                the rota starting point, then adjust for real-world details.
              </p>
            </div>
            <div className="planner-recommendation-stats">
              <div>
                <span>Busiest period</span>
                <strong>{peakHoursLabel}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{confidenceLabel}</strong>
              </div>
            </div>
          </section>

          <section className="planner-metrics" aria-label="Staffing plan summary">
            <PlannerMetricCard
              label="Staff hours"
              value={staffHoursLabel}
              detail="Estimated total staff hours for this selected day."
              icon="clock"
              tone="primary"
            />
            <PlannerMetricCard
              label="Labour cost"
              value={labourCostLabel}
              detail={labourCostDetail}
              icon="money"
              tone="indigo"
            />
            <PlannerMetricCard
              label="Peak demand"
              value={peakDemandSummary.value}
              detail={peakDemandSummary.detail}
              icon="trend"
              tone="amber"
            />
            <PlannerMetricCard
              label="Forecast confidence"
              value={confidenceLabel}
              detail={friendlyConfidence.detail}
              tone={friendlyConfidence.value === "High" ? "success" : "default"}
              icon="shield"
            />
            <PlannerMetricCard
              label="Forecast based on"
              value={hasCsv ? "Uploaded data" : "Business profile"}
              detail={forecastBasis}
              icon="document"
            />
          </section>

          <RotaGuidancePanel guidance={rotaGuidance} />

          <section className="planner-workspace">
            <div className="planner-chart">
              <ShapeOfDayChart roles={roles} data={chartData} />
              {hasSelectedContext && (
                <div className="context-adjustment-note">
                  <div className="context-adjustment-header">
                    <strong>Context included</strong>
                    <span>
                      Final context adjustment:{" "}
                      {formatPercentChange(contextSummary.percentChange)}
                    </span>
                  </div>
                  <ul>
                    {contextSummary.labels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="forecast-accuracy-note">
                <strong>Accuracy check</strong>
                <span>
                  {forecastBacktest?.status === "ready"
                    ? forecastBacktest.summary
                    : forecastBacktest?.summary ||
                      "Backtesting appears after enough CSV history is uploaded."}
                </span>
              </div>
              <ForecastFeedbackPanel
                selectedDate={selectedDate}
                chartData={chartData}
                roles={roles}
                feedbackEntries={staffingFeedback}
                onFeedbackSave={handleFeedbackSave}
              />
            </div>

            <div className="planner-calendar">
              <CalendarPanel
                selectedDate={selectedDate}
                onSelectedDateChange={setSelectedDate}
                dayConfigs={dayConfigs}
                onDayConfigChange={handleDayConfigChange}
              />
            </div>
          </section>
        </main>
      ) : (
        <main className="setup-view">
          <section className="setup-heading">
            <p className="section-kicker">Setup View</p>
            <h2>Business setup</h2>
            <p>
              Keep the profile, trading data, and role assumptions current so
              each plan starts from the right baseline.
            </p>
          </section>

          <section className="setup-layout">
            <div className="setup-left">
              <InfoCard
                title="Business profile"
                subtitle="These settings shape the starter forecast before CSV history is added."
                className="setup-card"
              >
                <label className="setup-field">
                  Business type
                  <select
                    value={businessType}
                    onChange={handleBusinessTypeChange}
                    className="business-select setup-select"
                  >
                    <option value="gym">Gym / Fitness</option>
                    <option value="cafe">Cafe / Restaurant</option>
                  </select>
                </label>
                <p className="upload-info">
                  Opening hours: {openingHours.open} - {openingHours.close}
                </p>
              </InfoCard>

              <InfoCard
                title="Data upload"
                subtitle="Upload trading history when you are ready to improve forecast confidence."
                className="setup-card"
              >
                <div className="csv-guidance" id="csv-upload-guidance">
                  <p>
                    CSV files need a timestamp, time, date, or datetime column.
                    Demand columns can include orders, sales, customers,
                    bookings, check-ins, covers, appointments, or similar
                    counts.
                  </p>
                  <p>
                    Add an actual staff column, such as staff_count or
                    scheduled_staff, when you want stronger backtesting.
                  </p>
                  <a
                    href="/sample-data/scheduloop-sample-demand.csv"
                    download
                    className="sample-csv-link"
                  >
                    Download sample CSV
                  </a>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvChange}
                  className="csv-input"
                  aria-describedby="csv-upload-guidance"
                />
                {uploadError && (
                  <p className="upload-error" role="alert">
                    {uploadError}
                  </p>
                )}
                {uploadInfo && !uploadError && (
                  <p className="upload-info">
                    Loaded <strong>{uploadInfo.rows}</strong> rows
                    {uploadInfo.skippedRows > 0
                      ? `; skipped ${uploadInfo.skippedRows} invalid or out-of-hours rows`
                      : ""}
                    . Metric: {uploadInfo.demandMetric?.column || "row count"}.
                    {uploadInfo.observedDays
                      ? ` Observed days: ${uploadInfo.observedDays}.`
                      : ""}
                    {uploadInfo.actualStaffRows > 0
                      ? ` Actual staffing rows: ${uploadInfo.actualStaffRows}.`
                      : ""}
                    {uploadInfo.hasRoleSpecificDemand
                      ? " Role-specific demand columns detected."
                      : ""}
                    {uploadInfo.intervalMinutes !==
                    operatingRules.intervalMinutes
                      ? " Re-upload after changing block size."
                      : ""}
                  </p>
                )}
                {!uploadInfo && !uploadError && (
                  <p className="upload-info">
                    No trading history uploaded yet. The planner is using your
                    business setup and typical demand pattern.
                  </p>
                )}

                <div className="setup-inline-status">
                  <span>Staffing history check</span>
                  <p>
                    {forecastBacktest?.status === "ready"
                      ? forecastBacktest.summary
                      : backtestSummary
                      ? `Average difference: ${backtestSummary.meanAbsoluteError.toFixed(
                          1
                        )} staff per block.`
                      : "Upload staff counts to compare the forecast with past staffing levels."}
                  </p>
                </div>
              </InfoCard>

              <AccuracySettingsPanel
                operatingRules={operatingRules}
                onOperatingRulesChange={handleOperatingRulesChange}
              />

              <InfoCard
                title="Current MVP limits"
                subtitle="What this version handles today, and what still needs manager judgement."
                className="setup-card"
              >
                <ul className="mvp-limits-list">
                  <li>Forecasts are planning guidance, not guaranteed answers.</li>
                  <li>Better CSV history improves confidence over time.</li>
                  <li>Manual context tags are available, but external weather, events, and roadworks APIs are not connected yet.</li>
                  <li>Rota publishing and payroll are not included yet.</li>
                </ul>
              </InfoCard>
            </div>

            <div className="setup-right">
              <StaffBreakdownPanel
                roles={roles}
                peakStaff={peakStaff}
                onStaffingChange={handleStaffingChange}
              />
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default DashboardPage;
