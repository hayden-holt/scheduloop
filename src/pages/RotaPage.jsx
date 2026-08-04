import { useEffect, useMemo, useState } from "react";
import InfoCard from "../components/InfoCard";
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
import { generateTimeSlots, toLocalDateKey } from "../utils/schedule";
import { isCurrentCsvDemandModel } from "../utils/demandModel";
import { getStaffingFeedback } from "../utils/staffingFeedback";
import { buildForecastChartData, buildPresetShape } from "../utils/forecastChartData";
import {
  addDaysToDateKey,
  calculateCoverageForDay,
  calculateShiftDurationHours,
  calculateWeeklyRotaTotals,
  copyShiftsToWeek,
  getCoverageSummary,
  getWeekDays,
  getWeekRangeLabel,
  getWeekStartDateKey,
  normalizeBreakMinutes,
  ROTA_STATUS,
  validateEmployee,
  validateShift,
} from "../utils/rota";
import { formatCurrencyGBP } from "../utils/labourCost";
import {
  createCopiedWeekShifts,
  deactivateEmployee,
  deleteShift,
  loadEmployees,
  loadRotaWeek,
  loadWeekShifts,
  saveEmployee,
  saveRotaWeekStatus,
  saveShift,
} from "../rota/rotaService";

const TIME_OPTIONS = [
  ...generateTimeSlots("05:00", "23:30", 30),
  "23:30",
];
const BREAK_OPTIONS = [0, 15, 30, 45, 60];

function formatHours(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(2)}h`;
}

function getRoleName(roles, roleId) {
  return roles.find((role) => role.id === roleId)?.name || "Role";
}

function getEmployeeName(employees, employeeId) {
  return (
    employees.find((employee) => employee.id === employeeId)?.displayName ||
    "Employee"
  );
}

function createEmptyEmployee(roles) {
  return {
    displayName: "",
    defaultRole: roles[0]?.id || "",
    hourlyRate: "",
    active: true,
  };
}

function createEmptyShift({ employees, roles, date }) {
  const firstEmployee = employees.find((employee) => employee.active !== false);
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

function getVisibleEmployees(employees, shifts) {
  const shiftedEmployeeIds = new Set(shifts.map((shift) => shift.employeeId));
  return employees.filter(
    (employee) => employee.active !== false || shiftedEmployeeIds.has(employee.id)
  );
}

function RotaStatusControl({ status, disabled, onChange }) {
  return (
    <div className="rota-status-control" aria-label="Rota status">
      <span className={`rota-status-pill rota-status-${status}`}>
        {status === ROTA_STATUS.published ? "Published" : "Draft"}
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled || status === ROTA_STATUS.draft}
        onClick={() => onChange(ROTA_STATUS.draft)}
      >
        Mark draft
      </button>
      <button
        type="button"
        className="primary-action-button"
        disabled={disabled || status === ROTA_STATUS.published}
        onClick={() => onChange(ROTA_STATUS.published)}
      >
        Publish rota
      </button>
    </div>
  );
}

function WeekSelector({ weekStart, onChange }) {
  return (
    <div className="week-selector" aria-label="Week selector">
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(addDaysToDateKey(weekStart, -7))}
      >
        Previous week
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(getWeekStartDateKey())}
      >
        Current week
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(addDaysToDateKey(weekStart, 7))}
      >
        Next week
      </button>
    </div>
  );
}

function EmployeeForm({ roles, employee, errors, submitting, onChange, onCancel, onSubmit }) {
  return (
    <form className="rota-form-grid" onSubmit={onSubmit}>
      <label>
        Employee name
        <input
          type="text"
          value={employee.displayName}
          onChange={(event) =>
            onChange({ ...employee, displayName: event.target.value })
          }
          placeholder="e.g. Maya"
        />
        {errors.displayName && <span className="form-error">{errors.displayName}</span>}
      </label>

      <label>
        Default role
        <select
          value={employee.defaultRole}
          onChange={(event) =>
            onChange({ ...employee, defaultRole: event.target.value })
          }
        >
          <option value="">Choose role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Hourly rate
        <input
          type="number"
          min="0"
          step="0.01"
          value={employee.hourlyRate ?? ""}
          onChange={(event) =>
            onChange({ ...employee, hourlyRate: event.target.value })
          }
          placeholder="Optional"
        />
      </label>

      <div className="rota-form-actions">
        <button type="submit" className="primary-action-button" disabled={submitting}>
          Save employee
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ShiftForm({
  employees,
  roles,
  shift,
  errors,
  submitting,
  weekDays,
  onChange,
  onCancel,
  onSubmit,
}) {
  return (
    <form className="rota-form-grid rota-shift-form" onSubmit={onSubmit}>
      <label>
        Employee
        <select
          value={shift.employeeId}
          onChange={(event) => {
            const employee = employees.find((item) => item.id === event.target.value);
            onChange({
              ...shift,
              employeeId: event.target.value,
              roleId: employee?.defaultRole || shift.roleId,
            });
          }}
        >
          <option value="">Choose employee</option>
          {employees
            .filter((employee) => employee.active !== false)
            .map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
        </select>
        {errors.employeeId && <span className="form-error">{errors.employeeId}</span>}
      </label>

      <label>
        Date
        <select
          value={shift.date}
          onChange={(event) => onChange({ ...shift, date: event.target.value })}
        >
          {weekDays.map((day) => (
            <option key={day.dateKey} value={day.dateKey}>
              {day.label}
            </option>
          ))}
        </select>
        {errors.date && <span className="form-error">{errors.date}</span>}
      </label>

      <label>
        Start
        <select
          value={shift.startTime}
          onChange={(event) =>
            onChange({ ...shift, startTime: event.target.value })
          }
        >
          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
        {errors.startTime && <span className="form-error">{errors.startTime}</span>}
      </label>

      <label>
        End
        <select
          value={shift.endTime}
          onChange={(event) => onChange({ ...shift, endTime: event.target.value })}
        >
          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
        {errors.endTime && <span className="form-error">{errors.endTime}</span>}
      </label>

      <label>
        Role
        <select
          value={shift.roleId}
          onChange={(event) => onChange({ ...shift, roleId: event.target.value })}
        >
          <option value="">Choose role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        {errors.roleId && <span className="form-error">{errors.roleId}</span>}
      </label>

      <label>
        Unpaid break
        <select
          value={shift.breakMinutes}
          onChange={(event) =>
            onChange({ ...shift, breakMinutes: Number(event.target.value) })
          }
        >
          {BREAK_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </select>
        {errors.breakMinutes && (
          <span className="form-error">{errors.breakMinutes}</span>
        )}
      </label>

      {errors.overlap && <p className="form-error rota-form-wide">{errors.overlap}</p>}

      <div className="rota-form-actions rota-form-wide">
        <button type="submit" className="primary-action-button" disabled={submitting}>
          Save shift
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ShiftCard({ shift, roles, onEdit, onDelete }) {
  return (
    <article className="rota-shift-card">
      <button type="button" onClick={() => onEdit(shift)}>
        <strong>
          {shift.startTime}-{shift.endTime}
        </strong>
        <span>{getRoleName(roles, shift.roleId)}</span>
        <small>{formatHours(calculateShiftDurationHours(shift))}</small>
      </button>
      <button
        type="button"
        className="rota-shift-delete"
        onClick={() => onDelete(shift)}
        aria-label={`Delete ${shift.startTime} shift`}
      >
        Delete
      </button>
    </article>
  );
}

function SimpleRotaShift({ shift, employees, roles, onEdit }) {
  return (
    <button
      type="button"
      className="simple-rota-shift"
      onClick={() => onEdit(shift)}
    >
      <span className="simple-rota-person">
        {getEmployeeName(employees, shift.employeeId)}
      </span>
      <span className="simple-rota-time">
        {shift.startTime}-{shift.endTime}
      </span>
      <span className="simple-rota-role">{getRoleName(roles, shift.roleId)}</span>
    </button>
  );
}

function SimpleWeeklyRotaBoard({
  weekDays,
  shifts,
  employees,
  roles,
  dailyHours,
  selectedDate,
  canAddShift,
  onSelectDate,
  onAddShift,
  onEditShift,
  onAddEmployee,
}) {
  const hasEmployees = employees.length > 0;
  const hasShifts = shifts.length > 0;

  return (
    <section className="simple-rota-board card" aria-label="Simple weekly rota">
      <div className="simple-rota-header">
        <div>
          <p className="section-kicker">This week's rota</p>
          <h2>Who's working, when, and where</h2>
          <p>
            A simple rota view for managers to build the week and for staff to
            read quickly.
          </p>
        </div>
        <button
          type="button"
          className="primary-action-button"
          disabled={!canAddShift}
          onClick={() => onAddShift(selectedDate)}
        >
          Add shift
        </button>
      </div>

      {!hasEmployees ? (
        <div className="simple-rota-empty">
          <h3>Add your first employee</h3>
          <p>Add the people who work shifts, then place them onto the week.</p>
          <button
            type="button"
            className="primary-action-button"
            onClick={onAddEmployee}
          >
            Add employee
          </button>
        </div>
      ) : !hasShifts ? (
        <div className="simple-rota-empty">
          <h3>No shifts yet</h3>
          <p>Pick a day below and add the first person working that day.</p>
        </div>
      ) : null}

      <div className="simple-rota-days">
        {weekDays.map((day) => {
          const dayShifts = shifts
            .filter((shift) => shift.date === day.dateKey)
            .sort((a, b) =>
              `${a.startTime}-${getEmployeeName(employees, a.employeeId)}`.localeCompare(
                `${b.startTime}-${getEmployeeName(employees, b.employeeId)}`
              )
            );

          return (
            <article
              key={day.dateKey}
              className={
                "simple-rota-day" +
                (selectedDate === day.dateKey ? " active" : "")
              }
            >
              <button
                type="button"
                className="simple-rota-day-header"
                onClick={() => onSelectDate(day.dateKey)}
              >
                <span>{day.shortLabel}</span>
                <small>{formatHours(dailyHours[day.dateKey] || 0)}</small>
              </button>

              <div className="simple-rota-shifts">
                {dayShifts.length === 0 ? (
                  <p>No one scheduled</p>
                ) : (
                  dayShifts.map((shift) => (
                    <SimpleRotaShift
                      key={shift.id}
                      shift={shift}
                      employees={employees}
                      roles={roles}
                      onEdit={onEditShift}
                    />
                  ))
                )}
              </div>

              <button
                type="button"
                className="simple-rota-add-day"
                disabled={!canAddShift}
                onClick={() => onAddShift(day.dateKey)}
              >
                Add shift
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CoverageSummary({ selectedDay, rows, summary }) {
  if (!rows.length) {
    return (
      <div className="rota-empty-state">
        <h3>No staffing recommendation available</h3>
        <p>
          Add business setup and forecast data first, then ScheduleLoop can
          compare the rota against recommended cover.
        </p>
      </div>
    );
  }

  return (
    <div className="coverage-summary">
      <div className="coverage-summary-header">
        <div>
          <h3>{selectedDay.label} coverage</h3>
          <p>Recommended staffing compared with scheduled shifts.</p>
        </div>
        <div className="coverage-status-counts">
          <span>{summary.matched} matched</span>
          <span>{summary.under} under</span>
          <span>{summary.over} over</span>
        </div>
      </div>

      {summary.under === 0 && summary.over === 0 && (
        <p className="coverage-positive">This day matches the staffing recommendation.</p>
      )}

      <div className="coverage-table" role="table" aria-label="Coverage comparison">
        <div className="coverage-row coverage-row-head" role="row">
          <span>Period</span>
          <span>Recommended</span>
          <span>Scheduled</span>
          <span>Status</span>
        </div>
        {rows.map((row) => (
          <div key={row.hour} className={`coverage-row coverage-${row.status}`} role="row">
            <span>
              {row.hour}-{row.endHour}
            </span>
            <span>{row.recommendedTotal}</span>
            <span>{row.scheduledTotal}</span>
            <span>
              {row.status === "matched"
                ? "Matches"
                : row.status === "under"
                  ? `${Math.abs(row.difference)} under`
                  : `${row.difference} over`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [employeeForm, setEmployeeForm] = useState(null);
  const [employeeErrors, setEmployeeErrors] = useState({});
  const [shiftForm, setShiftForm] = useState(null);
  const [shiftErrors, setShiftErrors] = useState({});

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
      if (!user?.uid) return;
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
            shifts: shifts.filter((shift) => shift.date === day.dateKey),
            roles,
            intervalMinutes: operatingRules.intervalMinutes,
          }),
        ])
      ),
    [forecastByDate, shifts, roles, operatingRules.intervalMinutes, weekDays]
  );
  const selectedDay =
    weekDays.find((day) => day.dateKey === selectedCoverageDate) || weekDays[0];
  const selectedCoverageRows = coverageByDate[selectedDay.dateKey] || [];
  const selectedCoverageSummary = getCoverageSummary(selectedCoverageRows);

  const markDraftIfPublished = async () => {
    if (weekStatus !== ROTA_STATUS.published || !user?.uid) return;
    await saveRotaWeekStatus(user.uid, weekStart, ROTA_STATUS.draft);
    setWeekStatus(ROTA_STATUS.draft);
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

  const handleCopyPreviousWeek = async () => {
    if (!user?.uid) return;
    const previousWeekStart = addDaysToDateKey(weekStart, -7);
    const existingMessage =
      shifts.length > 0
        ? " This week already has shifts, so copied shifts will be added alongside them."
        : "";
    const confirmed = window.confirm(
      `Copy shifts from ${getWeekRangeLabel(previousWeekStart)}?${existingMessage}`
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      const previousShifts = await loadWeekShifts(user.uid, previousWeekStart);
      if (previousShifts.length === 0) {
        setError("There are no shifts in the previous week to copy.");
        return;
      }
      await markDraftIfPublished();
      const copied = copyShiftsToWeek(previousShifts, weekStart);
      const saved = await createCopiedWeekShifts(user.uid, copied);
      await saveRotaWeekStatus(user.uid, weekStart, ROTA_STATUS.draft);
      setWeekStatus(ROTA_STATUS.draft);
      setShifts((current) => [...current, ...saved]);
    } catch (err) {
      console.error("Failed to copy previous week", err);
      setError("The previous week could not be copied.");
    } finally {
      setSaving(false);
    }
  };

  const handleStartShiftForDate = (date) => {
    setSelectedCoverageDate(date);
    setShiftForm(
      createEmptyShift({
        employees,
        roles,
        date,
      })
    );
  };

  return (
    <main className="rota-page">
      <section className="rota-hero">
        <div>
          <p className="section-kicker">Rota</p>
          <h2>Week of {getWeekRangeLabel(weekStart)}</h2>
          <p>
            Build the schedule, then compare planned cover with the existing
            ScheduleLoop forecast.
          </p>
        </div>
        <RotaStatusControl
          status={weekStatus}
          disabled={saving || loading}
          onChange={handleStatusChange}
        />
      </section>

      <SimpleWeeklyRotaBoard
        weekDays={weekDays}
        shifts={shifts}
        employees={employees}
        roles={roles}
        dailyHours={totals.dailyHours}
        selectedDate={selectedCoverageDate}
        canAddShift={!saving && activeEmployees.length > 0}
        onSelectDate={setSelectedCoverageDate}
        onAddShift={handleStartShiftForDate}
        onEditShift={setShiftForm}
        onAddEmployee={() => setEmployeeForm(createEmptyEmployee(roles))}
      />

      <section className="rota-toolbar">
        <WeekSelector weekStart={weekStart} onChange={setWeekStart} />
        <div className="rota-toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={saving || loading}
            onClick={handleCopyPreviousWeek}
          >
            Copy previous week
          </button>
          <button
            type="button"
            className="primary-action-button"
            disabled={activeEmployees.length === 0 || saving}
            onClick={() => handleStartShiftForDate(selectedCoverageDate)}
          >
            Add shift
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setEmployeeForm(createEmptyEmployee(roles))}
          >
            Add employee
          </button>
        </div>
      </section>

      {error && <div className="banner banner-error">{error}</div>}

      <section className="rota-summary-grid">
        <InfoCard title="Scheduled hours" subtitle="Total planned hours this week.">
          <strong className="rota-summary-value">{formatHours(totals.weeklyHours)}</strong>
        </InfoCard>
        <InfoCard title="Labour estimate" subtitle="Shown only when wage data is available.">
          <strong className="rota-summary-value">
            {totals.weeklyCost === null
              ? "Add wage data"
              : formatCurrencyGBP(totals.weeklyCost)}
          </strong>
        </InfoCard>
        <InfoCard title="Business" subtitle={basics.location || "No location set yet."}>
          <strong className="rota-summary-value">{basics.businessName}</strong>
        </InfoCard>
      </section>

      {(employeeForm || shiftForm) && (
        <section className="rota-editor-panel">
          {employeeForm && (
            <InfoCard
              title={employeeForm.id ? "Edit employee" : "Add employee"}
              subtitle="Keep the team list simple. Employee accounts are not part of this MVP."
            >
              <EmployeeForm
                roles={roles}
                employee={employeeForm}
                errors={employeeErrors}
                submitting={saving}
                onChange={setEmployeeForm}
                onCancel={() => {
                  setEmployeeForm(null);
                  setEmployeeErrors({});
                }}
                onSubmit={handleSaveEmployee}
              />
            </InfoCard>
          )}

          {shiftForm && (
            <InfoCard
              title={shiftForm.id ? "Edit shift" : "Add shift"}
              subtitle="Schedule one employee for one role and time block."
            >
              <ShiftForm
                employees={employees}
                roles={roles}
                shift={shiftForm}
                errors={shiftErrors}
                submitting={saving}
                weekDays={weekDays}
                onChange={setShiftForm}
                onCancel={() => {
                  setShiftForm(null);
                  setShiftErrors({});
                }}
                onSubmit={handleSaveShift}
              />
            </InfoCard>
          )}
        </section>
      )}

      <section className="rota-main-grid">
        <InfoCard
          title="Manager detail"
          subtitle="Use this grid for employee totals and precise shift edits."
          className="rota-week-card"
        >
          {loading ? (
            <div className="rota-empty-state">
              <h3>Loading rota</h3>
              <p>Fetching employees and shifts for this week.</p>
            </div>
          ) : visibleEmployees.length === 0 ? (
            <div className="rota-empty-state">
              <h3>No employees yet</h3>
              <p>Add the people you schedule, then create their first shifts.</p>
              <button
                type="button"
                className="primary-action-button"
                onClick={() => setEmployeeForm(createEmptyEmployee(roles))}
              >
                Add employee
              </button>
            </div>
          ) : (
            <div className="rota-grid-scroll">
              <table className="rota-grid-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {weekDays.map((day) => (
                      <th key={day.dateKey}>
                        <button
                          type="button"
                          className={
                            "rota-day-heading" +
                            (selectedCoverageDate === day.dateKey ? " active" : "")
                          }
                          onClick={() => setSelectedCoverageDate(day.dateKey)}
                        >
                          <span>{day.shortLabel}</span>
                          <small>{formatHours(totals.dailyHours[day.dateKey] || 0)}</small>
                        </button>
                      </th>
                    ))}
                    <th>Week</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <th scope="row">
                        <div className="rota-employee-cell">
                          <strong>{employee.displayName}</strong>
                          <span>
                            {getRoleName(roles, employee.defaultRole)}
                            {employee.active === false ? " · inactive" : ""}
                          </span>
                        </div>
                      </th>
                      {weekDays.map((day) => {
                        const cellShifts = shifts.filter(
                          (shift) =>
                            shift.employeeId === employee.id &&
                            shift.date === day.dateKey
                        );

                        return (
                          <td key={day.dateKey}>
                            <div className="rota-cell-shifts">
                              {cellShifts.length === 0 ? (
                                <span className="rota-cell-empty">No shift</span>
                              ) : (
                                cellShifts.map((shift) => (
                                  <ShiftCard
                                    key={shift.id}
                                    shift={shift}
                                    roles={roles}
                                    onEdit={setShiftForm}
                                    onDelete={handleDeleteShift}
                                  />
                                ))
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td>
                        <strong>{formatHours(totals.employeeHours[employee.id] || 0)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </InfoCard>

        <aside className="rota-side-panel">
          <InfoCard
            title="Employees"
            subtitle="Add team members you schedule regularly."
          >
            {employees.length === 0 ? (
              <p className="upload-info">No employees have been added yet.</p>
            ) : (
              <div className="rota-employee-list">
                {employees.map((employee) => (
                  <article key={employee.id} className="rota-employee-item">
                    <div>
                      <strong>{employee.displayName}</strong>
                      <span>
                        {getRoleName(roles, employee.defaultRole)}
                        {employee.active === false ? " · inactive" : ""}
                      </span>
                    </div>
                    <div className="rota-employee-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setEmployeeForm(employee)}
                      >
                        Edit
                      </button>
                      {employee.active !== false && (
                        <button
                          type="button"
                          className="secondary-button danger-light"
                          onClick={() => handleDeactivateEmployee(employee)}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </InfoCard>
        </aside>
      </section>

      <section className="rota-coverage-section">
        <InfoCard
          title="Forecast coverage check"
          subtitle="This uses the existing Shape of Day recommendation for the selected date."
        >
          <div className="coverage-day-tabs" aria-label="Coverage day">
            {weekDays.map((day) => {
              const summary = getCoverageSummary(coverageByDate[day.dateKey] || []);
              return (
                <button
                  type="button"
                  key={day.dateKey}
                  className={
                    "coverage-day-tab" +
                    (selectedCoverageDate === day.dateKey ? " active" : "")
                  }
                  onClick={() => setSelectedCoverageDate(day.dateKey)}
                >
                  <span>{day.shortLabel}</span>
                  <small>
                    {summary.under > 0
                      ? `${summary.under} under`
                      : summary.over > 0
                        ? `${summary.over} over`
                        : "matched"}
                  </small>
                </button>
              );
            })}
          </div>

          <CoverageSummary
            selectedDay={selectedDay}
            rows={selectedCoverageRows}
            summary={selectedCoverageSummary}
          />
        </InfoCard>
      </section>
    </main>
  );
}

export default RotaPage;
