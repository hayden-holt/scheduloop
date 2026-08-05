import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import {
  normalizeOperatingRules,
  normalizeRolesForAccuracy,
} from "../config/businessPresets";
import {
  getOpeningHoursForDate,
  normalizeBusinessProfileBasics,
  normalizeOpeningHours,
} from "../utils/businessProfileSetup";
import { isCurrentCsvDemandModel } from "../utils/demandModel";
import { buildForecastChartData, buildPresetShape } from "../utils/forecastChartData";
import {
  addDaysToDateKey,
  analyseCopyPreviousWeek,
  calculateCoverageForDay,
  calculateWeeklyRotaTotals,
  formatRotaSummaryText,
  getCoverageSummary,
  getWeekDays,
  getWeekRangeLabel,
  getWeekStartDateKey,
  normalizeBreakMinutes,
  ROTA_STATUS,
  validateEmployee,
  validateShift,
} from "../utils/rota";
import { toLocalDateKey } from "../utils/schedule";
import { getStaffingFeedback } from "../utils/staffingFeedback";
import {
  copyWeekShiftsAsDraft,
  deactivateEmployee,
  deleteShift,
  loadEmployees,
  loadRotaWeek,
  loadWeekShifts,
  replaceWeekShiftsAsDraft,
  saveEmployee,
  saveRotaWeekStatus,
  saveShift,
} from "../rota/rotaService";
import {
  CopyPreviousWeekDialog,
  CoveragePanel,
  EmployeeManagerDialog,
  PrintableRota,
  RotaGrid,
  RotaHeader,
  RotaSummaryStrip,
  RotaToolbar,
  ShiftDialog,
} from "../rota/RotaComponents";
import {
  createEmptyEmployee,
  createEmptyShift,
  getVisibleEmployees,
} from "../rota/rotaViewHelpers";

function RotaPage() {
  const { user } = useAuth();
  const { profile } = useBusinessProfile();
  const basics = normalizeBusinessProfileBasics(profile);
  const roles = useMemo(
    () => normalizeRolesForAccuracy(profile?.roles || []),
    [profile?.roles]
  );
  const operatingRules = useMemo(
    () => normalizeOperatingRules(profile?.operatingRules),
    [profile?.operatingRules]
  );
  const profileHours = useMemo(
    () => normalizeOpeningHours(profile?.hours),
    [profile?.hours]
  );
  const presetShape = useMemo(() => buildPresetShape(roles), [roles]);
  const [weekStart, setWeekStart] = useState(() =>
    getWeekStartDateKey(toLocalDateKey(new Date()))
  );
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const [selectedCoverageDate, setSelectedCoverageDate] = useState(
    weekDays[0].dateKey
  );
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [weekStatus, setWeekStatus] = useState(ROTA_STATUS.draft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [employeeManagerOpen, setEmployeeManagerOpen] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(null);
  const [employeeErrors, setEmployeeErrors] = useState({});
  const [shiftForm, setShiftForm] = useState(null);
  const [shiftErrors, setShiftErrors] = useState({});
  const [copyDialog, setCopyDialog] = useState({
    open: false,
    loading: false,
    previousShifts: [],
    analysis: null,
    error: "",
    report: "",
  });

  useEffect(() => {
    setSelectedCoverageDate((current) =>
      weekDays.some((day) => day.dateKey === current)
        ? current
        : weekDays[0].dateKey
    );
  }, [weekDays]);

  useEffect(() => {
    let active = true;

    async function loadRota() {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [nextEmployees, nextShifts, nextWeek] = await Promise.all([
          loadEmployees(user.uid),
          loadWeekShifts(user.uid, weekStart),
          loadRotaWeek(user.uid, weekStart),
        ]);

        if (!active) return;
        setEmployees(nextEmployees);
        setShifts(nextShifts);
        setWeekStatus(nextWeek.status);
      } catch (err) {
        console.error("Failed to load rota", err);
        if (active) {
          setError("The rota could not be loaded. Please try again.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRota();

    return () => {
      active = false;
    };
  }, [user?.uid, weekStart]);

  const visibleEmployees = useMemo(
    () => getVisibleEmployees(employees, shifts),
    [employees, shifts]
  );
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active !== false),
    [employees]
  );
  const shiftsByDate = useMemo(
    () =>
      shifts.reduce((grouped, shift) => {
        grouped[shift.date] = [...(grouped[shift.date] || []), shift];
        return grouped;
      }, {}),
    [shifts]
  );
  const forecastByDate = useMemo(() => {
    const csvCurves = isCurrentCsvDemandModel(profile?.csvDemand)
      ? profile.csvDemand
      : null;
    const hasCsv = !!(csvCurves && csvCurves.rows > 0);
    const staffingFeedback = getStaffingFeedback(profile);

    return Object.fromEntries(
      weekDays.map((day) => {
        const openingHours = getOpeningHoursForDate(profileHours, day.dateKey);
        return [
          day.dateKey,
          buildForecastChartData({
            roles,
            peakStaff: profile?.peakStaff || {},
            openingHours,
            operatingRules,
            selectedDate: day.dateKey,
            dayConfigs: profile?.dayConfigs || {},
            busyLevel: profile?.busyLevel || "normal",
            hasCsv,
            csvCurves,
            presetShape,
            staffingFeedback,
          }),
        ];
      })
    );
  }, [profile, profileHours, operatingRules, presetShape, roles, weekDays]);
  const totals = useMemo(
    () =>
      calculateWeeklyRotaTotals({
        shifts,
        employees,
        weekDays,
        roles,
        averageHourlyWage: operatingRules.averageHourlyWage,
      }),
    [shifts, employees, weekDays, roles, operatingRules.averageHourlyWage]
  );
  const coverageByDate = useMemo(
    () =>
      Object.fromEntries(
        weekDays.map((day) => [
          day.dateKey,
          calculateCoverageForDay({
            forecastPoints: forecastByDate[day.dateKey] || [],
            shifts: shiftsByDate[day.dateKey] || [],
            roles,
            intervalMinutes: operatingRules.intervalMinutes,
          }),
        ])
      ),
    [forecastByDate, shiftsByDate, roles, operatingRules.intervalMinutes, weekDays]
  );
  const selectedDay =
    weekDays.find((day) => day.dateKey === selectedCoverageDate) || weekDays[0];
  const selectedCoverageRows = coverageByDate[selectedDay.dateKey] || [];
  const selectedCoverageSummary = getCoverageSummary(selectedCoverageRows);
  const previousWeekStart = addDaysToDateKey(weekStart, -7);

  const markDraftIfPublished = async () => {
    if (weekStatus !== ROTA_STATUS.published || !user?.uid) return;
    await saveRotaWeekStatus(user.uid, weekStart, ROTA_STATUS.draft);
    setWeekStatus(ROTA_STATUS.draft);
  };

  const openEmployeeManager = (nextEmployeeForm = null) => {
    setEmployeeManagerOpen(true);
    setEmployeeForm(nextEmployeeForm);
    setEmployeeErrors({});
  };

  const closeEmployeeManager = () => {
    setEmployeeManagerOpen(false);
    setEmployeeForm(null);
    setEmployeeErrors({});
  };

  const handleSaveEmployee = async (event) => {
    event.preventDefault();
    const result = validateEmployee(employeeForm);
    setEmployeeErrors(result.errors);
    if (!result.isValid || !user?.uid) return;

    setSaving(true);
    setError("");
    try {
      const saved = await saveEmployee(user.uid, {
        ...employeeForm,
        ...result.normalized,
      });
      setEmployees((current) => {
        const existing = current.some((employee) => employee.id === saved.id);
        if (existing) {
          return current.map((employee) =>
            employee.id === saved.id ? saved : employee
          );
        }
        return [...current, saved].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        );
      });
      setEmployeeForm(null);
      setEmployeeErrors({});
    } catch (err) {
      console.error("Failed to save employee", err);
      setError("The employee could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateEmployee = async (employee) => {
    const confirmed = window.confirm(
      `Deactivate ${employee.displayName}? Existing shifts stay on the rota.`
    );
    if (!confirmed || !user?.uid) return;

    setSaving(true);
    setError("");
    try {
      await deactivateEmployee(user.uid, employee.id);
      setEmployees((current) =>
        current.map((item) =>
          item.id === employee.id ? { ...item, active: false } : item
        )
      );
    } catch (err) {
      console.error("Failed to deactivate employee", err);
      setError("The employee could not be deactivated.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveShift = async (event) => {
    event.preventDefault();
    const result = validateShift(shiftForm, {
      employees,
      shifts,
      editingShiftId: shiftForm?.id,
    });
    setShiftErrors(result.errors);
    if (!result.isValid || !user?.uid) return;

    setSaving(true);
    setError("");
    try {
      await markDraftIfPublished();
      const saved = await saveShift(user.uid, {
        ...shiftForm,
        breakMinutes: normalizeBreakMinutes(shiftForm.breakMinutes),
        weekStart,
      });
      setShifts((current) => {
        const existing = current.some((shift) => shift.id === saved.id);
        if (existing) {
          return current.map((shift) => (shift.id === saved.id ? saved : shift));
        }
        return [...current, saved];
      });
      setShiftForm(null);
      setShiftErrors({});
    } catch (err) {
      console.error("Failed to save shift", err);
      setError("The shift could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (shift) => {
    const confirmed = window.confirm(
      `Delete the ${shift.startTime}-${shift.endTime} shift?`
    );
    if (!confirmed || !user?.uid) return;

    setSaving(true);
    setError("");
    try {
      await markDraftIfPublished();
      await deleteShift(user.uid, shift.id);
      setShifts((current) => current.filter((item) => item.id !== shift.id));
      setShiftForm(null);
      setShiftErrors({});
    } catch (err) {
      console.error("Failed to delete shift", err);
      setError("The shift could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status) => {
    if (!user?.uid) return;
    setSaving(true);
    setError("");
    try {
      await saveRotaWeekStatus(user.uid, weekStart, status);
      setWeekStatus(status);
    } catch (err) {
      console.error("Failed to update rota status", err);
      setError("The rota status could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenCopyPreviousWeek = async () => {
    if (!user?.uid) return;

    setCopyDialog({
      open: true,
      loading: true,
      previousShifts: [],
      analysis: null,
      error: "",
      report: "",
    });

    try {
      const previousShifts = await loadWeekShifts(user.uid, previousWeekStart);
      const analysis = analyseCopyPreviousWeek({
        previousShifts,
        targetWeekStartKey: weekStart,
        targetShifts: shifts,
        employees,
      });
      setCopyDialog({
        open: true,
        loading: false,
        previousShifts,
        analysis,
        error: "",
        report:
          previousShifts.length === 0
            ? "There are no shifts in the previous week to copy."
            : "",
      });
    } catch (err) {
      console.error("Failed to check previous week", err);
      setCopyDialog((current) => ({
        ...current,
        loading: false,
        error: "The previous week could not be checked.",
      }));
    }
  };

  const handleCopySafeShifts = async () => {
    if (!user?.uid || !copyDialog.analysis) return;
    const safeShifts = copyDialog.analysis.safeShifts;
    if (safeShifts.length === 0) {
      setCopyDialog((current) => ({
        ...current,
        report: "There are no safe shifts to copy.",
      }));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await copyWeekShiftsAsDraft(user.uid, weekStart, safeShifts);
      const nextShifts = [...shifts, ...saved];
      setShifts(nextShifts);
      setWeekStatus(ROTA_STATUS.draft);
      setCopyDialog((current) => ({
        ...current,
        analysis: analyseCopyPreviousWeek({
          previousShifts: current.previousShifts,
          targetWeekStartKey: weekStart,
          targetShifts: nextShifts,
          employees,
        }),
        report: `${saved.length} safe shift${saved.length === 1 ? "" : "s"} copied. The rota is now a draft.`,
      }));
    } catch (err) {
      console.error("Failed to copy previous week", err);
      setCopyDialog((current) => ({
        ...current,
        error: "The safe shifts could not be copied.",
      }));
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceCurrentWeek = async () => {
    if (!user?.uid || !copyDialog.previousShifts.length) return;
    const replacementAnalysis = analyseCopyPreviousWeek({
      previousShifts: copyDialog.previousShifts,
      targetWeekStartKey: weekStart,
      targetShifts: [],
      employees,
    });
    const replacementShifts = replacementAnalysis.safeShifts;

    if (replacementShifts.length === 0) {
      setCopyDialog((current) => ({
        ...current,
        report:
          "There are no valid previous-week shifts to use as a replacement.",
      }));
      return;
    }

    const confirmed = window.confirm(
      `Replace this week? This will delete ${shifts.length} current shift${
        shifts.length === 1 ? "" : "s"
      } for ${getWeekRangeLabel(weekStart)} and create ${replacementShifts.length} copied shift${
        replacementShifts.length === 1 ? "" : "s"
      }. Employees and the previous week will not be deleted.`
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      const result = await replaceWeekShiftsAsDraft(
        user.uid,
        weekStart,
        replacementShifts
      );
      setShifts(result.shifts);
      setWeekStatus(ROTA_STATUS.draft);
      setCopyDialog((current) => ({
        ...current,
        analysis: analyseCopyPreviousWeek({
          previousShifts: current.previousShifts,
          targetWeekStartKey: weekStart,
          targetShifts: result.shifts,
          employees,
        }),
        report: `Replaced ${result.deletedCount} current shift${
          result.deletedCount === 1 ? "" : "s"
        } with ${result.shifts.length} copied shift${
          result.shifts.length === 1 ? "" : "s"
        }. The rota is now a draft.`,
      }));
    } catch (err) {
      console.error("Failed to replace current week", err);
      setCopyDialog((current) => ({
        ...current,
        error: "The current week could not be replaced.",
      }));
    } finally {
      setSaving(false);
    }
  };

  const handleStartShiftForDate = (date, employeeId = "") => {
    setSelectedCoverageDate(date);
    setShiftErrors({});
    setShiftForm(
      createEmptyShift({
        employees,
        roles,
        date,
        employeeId,
      })
    );
  };

  const handlePrintRota = () => {
    window.print();
  };

  const handleCopyRotaSummary = async () => {
    const text = formatRotaSummaryText({
      businessName: basics.businessName,
      location: basics.location,
      weekStart,
      weekDays,
      status: weekStatus,
      shifts,
      employees,
      roles,
    });

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      setShareMessage("Rota summary copied.");
    } catch (err) {
      console.error("Failed to copy rota summary", err);
      setShareMessage("Could not copy the rota summary on this browser.");
    }
  };

  return (
    <main className="rota-page">
      <RotaHeader
        weekStart={weekStart}
        weekStatus={weekStatus}
        saving={saving}
        loading={loading}
        shareMessage={shareMessage}
        onStatusChange={handleStatusChange}
        onPrint={handlePrintRota}
        onCopySummary={handleCopyRotaSummary}
      />

      <RotaToolbar
        weekStart={weekStart}
        saving={saving}
        loading={loading}
        canAddShift={activeEmployees.length > 0}
        onWeekChange={setWeekStart}
        onCopyPreviousWeek={handleOpenCopyPreviousWeek}
        onAddShift={() => handleStartShiftForDate(selectedCoverageDate)}
        onManageEmployees={() => openEmployeeManager()}
      />

      {error && <div className="banner banner-error">{error}</div>}

      <RotaSummaryStrip
        totals={totals}
        shifts={shifts}
        visibleEmployees={visibleEmployees}
        coverageByDate={coverageByDate}
        weekStatus={weekStatus}
      />

      <RotaGrid
        loading={loading}
        visibleEmployees={visibleEmployees}
        weekDays={weekDays}
        shifts={shifts}
        roles={roles}
        dailyHours={totals.dailyHours}
        employeeHours={totals.employeeHours}
        selectedDate={selectedCoverageDate}
        canAddShift={activeEmployees.length > 0 && !saving}
        onSelectDate={setSelectedCoverageDate}
        onAddEmployee={() => openEmployeeManager(createEmptyEmployee(roles))}
        onAddShift={handleStartShiftForDate}
        onEditShift={setShiftForm}
      />

      <CoveragePanel
        weekDays={weekDays}
        coverageByDate={coverageByDate}
        selectedDay={selectedDay}
        selectedDate={selectedCoverageDate}
        rows={selectedCoverageRows}
        summary={selectedCoverageSummary}
        onSelectDate={setSelectedCoverageDate}
      />

      <EmployeeManagerDialog
        open={employeeManagerOpen}
        employees={employees}
        roles={roles}
        employeeForm={employeeForm}
        employeeErrors={employeeErrors}
        saving={saving}
        onClose={closeEmployeeManager}
        onStartAdd={() => setEmployeeForm(createEmptyEmployee(roles))}
        onEditEmployee={(employee) => {
          setEmployeeErrors({});
          setEmployeeForm(employee);
        }}
        onDeactivateEmployee={handleDeactivateEmployee}
        onEmployeeChange={setEmployeeForm}
        onCancelEmployeeForm={() => {
          setEmployeeForm(null);
          setEmployeeErrors({});
        }}
        onSubmitEmployee={handleSaveEmployee}
      />

      <ShiftDialog
        shift={shiftForm}
        employees={employees}
        roles={roles}
        errors={shiftErrors}
        saving={saving}
        weekDays={weekDays}
        onChange={setShiftForm}
        onClose={() => {
          setShiftForm(null);
          setShiftErrors({});
        }}
        onDelete={handleDeleteShift}
        onSubmit={handleSaveShift}
      />

      <CopyPreviousWeekDialog
        open={copyDialog.open}
        loading={copyDialog.loading}
        saving={saving}
        analysis={copyDialog.analysis}
        error={copyDialog.error}
        report={copyDialog.report}
        previousWeekLabel={getWeekRangeLabel(previousWeekStart)}
        onCopySafe={handleCopySafeShifts}
        onReplace={handleReplaceCurrentWeek}
        onClose={() =>
          setCopyDialog({
            open: false,
            loading: false,
            previousShifts: [],
            analysis: null,
            error: "",
            report: "",
          })
        }
      />

      <PrintableRota
        businessName={basics.businessName}
        location={basics.location}
        weekStart={weekStart}
        weekStatus={weekStatus}
        weekDays={weekDays}
        shifts={shifts}
        employees={visibleEmployees}
        roles={roles}
        employeeHours={totals.employeeHours}
        weeklyHours={totals.weeklyHours}
      />
    </main>
  );
}

export default RotaPage;
