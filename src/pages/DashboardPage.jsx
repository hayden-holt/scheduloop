import { useEffect, useMemo, useState } from "react";
import ShapeOfDayChart from "../components/ShapeOfDayChart";
import InfoCard from "../components/InfoCard";
import CalendarPanel from "../components/CalendarPanel";
import StaffBreakdownPanel from "../components/StaffBreakdownPanel";
import AccuracySettingsPanel from "../components/AccuracySettingsPanel";
import RotaGuidancePanel from "../components/RotaGuidancePanel";
import ForecastFeedbackPanel from "../components/ForecastFeedbackPanel";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import {
  getBusinessPresetRoles,
  normalizeOperatingRules,
  normalizeRolesForAccuracy,
} from "../config/businessPresets";
import {
  getWeekdayFromDateKey,
  holidayDateKey,
  toLocalDateKey,
} from "../utils/schedule";
import { assertCsvFileIsSafe, parseCsvDemand } from "../utils/csvDemand";
import {
  calculateBacktestSummary,
  runForecastBacktest,
} from "../utils/staffing";
import {
  getDemandConfidence,
  hasRoleSpecificDemandForRoles,
  isCurrentCsvDemandModel,
} from "../utils/demandModel";
import {
  buildForecastChartData,
  buildPresetShape,
} from "../utils/forecastChartData";
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
  getStaffingFeedback,
  saveStaffingFeedback,
} from "../utils/staffingFeedback";
import {
  getContextAdjustmentSummary,
  hasActiveDayContext,
  normaliseDayConfigs,
  normaliseDayContext,
} from "../utils/dayContext";

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

function formatStaffHours(hours) {
  const rounded = Math.round((Number(hours) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatPercentChange(percent) {
  const rounded = Math.round(Number(percent) || 0);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
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
  const { profile, saveProfile, saveCsvDemand } = useBusinessProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const storedCsvDemand = isCurrentCsvDemandModel(profile?.csvDemand)
    ? profile.csvDemand
    : null;
  const hasOutdatedCsvDemand = Boolean(profile?.csvDemand && !storedCsvDemand);

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
  const activeView =
    searchParams.get("view") === "setup" ? "setup" : "planner";

  useEffect(() => {
    if (location.hash === "#settings") {
      navigate("/settings", { replace: true });
    }
  }, [location.hash, navigate]);

  const hasCsv = !!(csvCurves && csvCurves.rows > 0);
  const currentDayConfig = dayConfigs[selectedDate] || {};
  const selectedDayContext = normaliseDayContext(currentDayConfig.context);
  const hasSelectedContext = hasActiveDayContext(selectedDayContext);
  const contextSummary = getContextAdjustmentSummary(selectedDayContext);

  const persistProfilePatch = async (patch) => {
    try {
      await saveProfile(patch);
      setDashboardError("");
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      setDashboardError("Your latest change could not be saved.");
    }
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
        if (import.meta.env.DEV) console.error(err);
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

  const presetShape = useMemo(() => buildPresetShape(roles), [roles]);

  const chartData = useMemo(() => {
    return buildForecastChartData({
      roles,
      peakStaff,
      openingHours,
      operatingRules,
      selectedDate,
      dayConfigs,
      busyLevel,
      hasCsv,
      csvCurves,
      presetShape,
      staffingFeedback,
    });
  }, [
    roles,
    peakStaff,
    openingHours,
    operatingRules,
    selectedDate,
    dayConfigs,
    busyLevel,
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
      if (import.meta.env.DEV) console.error(err);
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
    <div className="dashboard-page">
      {dashboardError && (
        <div className="banner banner-error">{dashboardError}</div>
      )}

      {activeView === "planner" ? (
        <main className="planner-view" id="forecast">
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
          <section className="setup-layout">
            <div className="setup-left">
              <InfoCard
                title="Data upload"
                subtitle="Upload trading history when you are ready to improve forecast confidence."
                className="setup-card"
                id="data-imports"
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
