import InfoCard from "../components/InfoCard";
import { formatCurrencyGBP } from "../utils/labourCost";
import {
  addDaysToDateKey,
  COVERAGE_STATUS,
  formatCoverageValue,
  getCoverageSummary,
  getWeekRangeLabel,
  getWeekStartDateKey,
  normalizeBreakMinutes,
  ROTA_STATUS,
} from "../utils/rota";
import {
  BREAK_OPTIONS,
  formatHours,
  getRoleName,
  getShiftHoursLabel,
  TIME_OPTIONS,
} from "./rotaViewHelpers";

export function RotaStatusControl({ status, disabled, onChange }) {
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

export function WeekSelector({ weekStart, onChange }) {
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

export function RotaHeader({
  weekStart,
  weekStatus,
  saving,
  loading,
  shareMessage,
  onStatusChange,
  onPrint,
  onCopySummary,
}) {
  return (
    <section className="rota-hero">
      <div>
        <p className="section-kicker">Rota</p>
        <h2>Week of {getWeekRangeLabel(weekStart)}</h2>
        <p>
          Build the weekly schedule, then compare planned cover with the
          ScheduleLoop forecast.
        </p>
        {shareMessage && <p className="rota-share-message">{shareMessage}</p>}
      </div>
      <div className="rota-hero-actions">
        <div className="rota-share-actions">
          <button type="button" className="secondary-button" onClick={onPrint}>
            Print
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCopySummary}
          >
            Copy summary
          </button>
        </div>
        <RotaStatusControl
          status={weekStatus}
          disabled={saving || loading}
          onChange={onStatusChange}
        />
      </div>
    </section>
  );
}

export function RotaToolbar({
  weekStart,
  saving,
  loading,
  canAddShift,
  onWeekChange,
  onCopyPreviousWeek,
  onAddShift,
  onManageEmployees,
}) {
  return (
    <section className="rota-toolbar">
      <WeekSelector weekStart={weekStart} onChange={onWeekChange} />
      <div className="rota-toolbar-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={saving || loading}
          onClick={onCopyPreviousWeek}
        >
          Copy previous week
        </button>
        <button
          type="button"
          className="primary-action-button"
          disabled={!canAddShift || saving}
          onClick={onAddShift}
        >
          Add shift
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onManageEmployees}
        >
          Manage employees
        </button>
      </div>
    </section>
  );
}

export function RotaSummaryStrip({
  totals,
  shifts,
  visibleEmployees,
  coverageByDate,
  weekStatus,
}) {
  const scheduledEmployeeCount = new Set(shifts.map((shift) => shift.employeeId)).size;
  const coverageTotals = Object.values(coverageByDate).reduce(
    (counts, rows) => {
      const summary = getCoverageSummary(rows);
      counts.under += summary.under;
      counts.roleMismatch += summary.roleMismatch;
      counts.over += summary.over;
      return counts;
    },
    { under: 0, roleMismatch: 0, over: 0 }
  );
  const attentionCount =
    coverageTotals.under + coverageTotals.roleMismatch + coverageTotals.over;

  return (
    <section className="rota-summary-strip" aria-label="Rota summary">
      <div>
        <span>Scheduled hours</span>
        <strong>{formatHours(totals.weeklyHours)}</strong>
      </div>
      <div>
        <span>Labour estimate</span>
        <strong>
          {totals.weeklyCost === null
            ? "Add wage data"
            : formatCurrencyGBP(totals.weeklyCost)}
        </strong>
      </div>
      <div>
        <span>Employees scheduled</span>
        <strong>
          {scheduledEmployeeCount}/{visibleEmployees.length || 0}
        </strong>
      </div>
      <div>
        <span>Coverage checks</span>
        <strong>{attentionCount ? `${attentionCount} need review` : "Matched"}</strong>
      </div>
      <div>
        <span>Status</span>
        <strong>{weekStatus === ROTA_STATUS.published ? "Published" : "Draft"}</strong>
      </div>
    </section>
  );
}

function RotaDialog({ title, subtitle, wide = false, onClose, children }) {
  const titleId = `rota-dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="rota-modal-backdrop">
      <div
        className={`rota-modal${wide ? " rota-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="rota-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmployeeForm({
  roles,
  employee,
  errors,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}) {
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

      <div className="rota-form-actions rota-form-wide">
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

export function EmployeeManagerDialog({
  open,
  employees,
  roles,
  employeeForm,
  employeeErrors,
  saving,
  onClose,
  onStartAdd,
  onEditEmployee,
  onDeactivateEmployee,
  onEmployeeChange,
  onCancelEmployeeForm,
  onSubmitEmployee,
}) {
  if (!open) return null;

  return (
    <RotaDialog
      title="Manage employees"
      subtitle="Add the people who appear on the rota. Employee accounts are not part of this MVP."
      wide
      onClose={onClose}
    >
      <div className="rota-dialog-split">
        <section className="rota-dialog-panel">
          <div className="rota-dialog-panel-header">
            <h3>Team list</h3>
            <button type="button" className="primary-action-button" onClick={onStartAdd}>
              Add employee
            </button>
          </div>
          {employees.length === 0 ? (
            <div className="rota-empty-state">
              <h3>No employees yet</h3>
              <p>Add the people you schedule, then place them onto the week.</p>
            </div>
          ) : (
            <div className="rota-employee-list">
              {employees.map((employee) => (
                <article key={employee.id} className="rota-employee-item">
                  <div>
                    <strong>{employee.displayName}</strong>
                    <span>
                      {getRoleName(roles, employee.defaultRole)}
                      {employee.active === false ? " - inactive" : ""}
                    </span>
                  </div>
                  <div className="rota-employee-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onEditEmployee(employee)}
                    >
                      Edit
                    </button>
                    {employee.active !== false && (
                      <button
                        type="button"
                        className="secondary-button danger-light"
                        onClick={() => onDeactivateEmployee(employee)}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rota-dialog-panel">
          {employeeForm ? (
            <>
              <h3>{employeeForm.id ? "Edit employee" : "Add employee"}</h3>
              <EmployeeForm
                roles={roles}
                employee={employeeForm}
                errors={employeeErrors}
                submitting={saving}
                onChange={onEmployeeChange}
                onCancel={onCancelEmployeeForm}
                onSubmit={onSubmitEmployee}
              />
            </>
          ) : (
            <div className="rota-empty-state">
              <h3>Choose an employee</h3>
              <p>Edit a person from the team list, or add someone new.</p>
            </div>
          )}
        </section>
      </div>
    </RotaDialog>
  );
}

export function ShiftForm({
  employees,
  roles,
  shift,
  errors,
  submitting,
  weekDays,
  onChange,
  onCancel,
  onDelete,
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
        {shift.id && (
          <button
            type="button"
            className="secondary-button danger-light"
            disabled={submitting}
            onClick={() => onDelete(shift)}
          >
            Delete shift
          </button>
        )}
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ShiftDialog({
  shift,
  employees,
  roles,
  errors,
  saving,
  weekDays,
  onChange,
  onClose,
  onDelete,
  onSubmit,
}) {
  if (!shift) return null;

  return (
    <RotaDialog
      title={shift.id ? "Edit shift" : "Add shift"}
      subtitle="Schedule one employee for one role and time block."
      onClose={onClose}
    >
      <ShiftForm
        employees={employees}
        roles={roles}
        shift={shift}
        errors={errors}
        submitting={saving}
        weekDays={weekDays}
        onChange={onChange}
        onCancel={onClose}
        onDelete={onDelete}
        onSubmit={onSubmit}
      />
    </RotaDialog>
  );
}

function ShiftCard({ shift, roles, onEdit }) {
  return (
    <button
      type="button"
      className="rota-shift-card"
      onClick={() => onEdit(shift)}
      aria-label={`Edit ${shift.startTime}-${shift.endTime} shift`}
    >
      <strong>
        {shift.startTime}-{shift.endTime}
      </strong>
      <span>{getRoleName(roles, shift.roleId)}</span>
      <small>{getShiftHoursLabel(shift)}</small>
    </button>
  );
}

export function RotaGrid({
  loading,
  visibleEmployees,
  weekDays,
  shifts,
  roles,
  dailyHours,
  employeeHours,
  selectedDate,
  canAddShift,
  onSelectDate,
  onAddEmployee,
  onAddShift,
  onEditShift,
}) {
  return (
    <InfoCard
      title="Weekly rota"
      subtitle="One simple rota view for managers to build the week and for staff to read quickly."
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
          <button type="button" className="primary-action-button" onClick={onAddEmployee}>
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
                        (selectedDate === day.dateKey ? " active" : "")
                      }
                      onClick={() => onSelectDate(day.dateKey)}
                    >
                      <span>{day.shortLabel}</span>
                      <small>{formatHours(dailyHours[day.dateKey] || 0)}</small>
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
                        {employee.active === false ? " - inactive" : ""}
                      </span>
                    </div>
                  </th>
                  {weekDays.map((day) => {
                    const cellShifts = shifts
                      .filter(
                        (shift) =>
                          shift.employeeId === employee.id && shift.date === day.dateKey
                      )
                      .sort((a, b) => a.startTime.localeCompare(b.startTime));
                    const canAddForEmployee =
                      canAddShift && employee.active !== false && cellShifts.length === 0;

                    return (
                      <td key={day.dateKey}>
                        <div className="rota-cell-shifts">
                          {cellShifts.length === 0 ? (
                            canAddForEmployee ? (
                              <button
                                type="button"
                                className="rota-cell-add"
                                onClick={() => onAddShift(day.dateKey, employee.id)}
                              >
                                Add shift
                              </button>
                            ) : (
                              <span className="rota-cell-empty">No shift</span>
                            )
                          ) : (
                            cellShifts.map((shift) => (
                              <ShiftCard
                                key={shift.id}
                                shift={shift}
                                roles={roles}
                                onEdit={onEditShift}
                              />
                            ))
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <strong>{formatHours(employeeHours[employee.id] || 0)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </InfoCard>
  );
}

function formatDifferenceLabel(difference) {
  const formatted = formatCoverageValue(Math.abs(difference));
  if (Math.abs(Number(difference) || 0) <= 0.01) return "0";
  return difference < 0 ? `-${formatted}` : `+${formatted}`;
}

function formatRoleIssues(row) {
  const issues = row.roleCoverage.filter(
    (role) => role.status !== COVERAGE_STATUS.matched
  );

  if (!issues.length) return "Roles match";

  return issues
    .map((role) => {
      const direction = role.difference < 0 ? "short" : "extra";
      return `${role.roleName}: ${formatCoverageValue(Math.abs(role.difference))} ${direction}`;
    })
    .join("; ");
}

export function CoveragePanel({
  weekDays,
  coverageByDate,
  selectedDay,
  selectedDate,
  rows,
  summary,
  onSelectDate,
}) {
  return (
    <section className="rota-coverage-section">
      <InfoCard
        title="Forecast coverage check"
        subtitle="Compare this rota with the existing Shape of Day staffing recommendation."
      >
        <div className="coverage-day-tabs" aria-label="Coverage day">
          {weekDays.map((day) => {
            const daySummary = getCoverageSummary(coverageByDate[day.dateKey] || []);
            return (
              <button
                type="button"
                key={day.dateKey}
                className={
                  "coverage-day-tab" + (selectedDate === day.dateKey ? " active" : "")
                }
                onClick={() => onSelectDate(day.dateKey)}
              >
                <span>{day.shortLabel}</span>
                <small>
                  {daySummary.under > 0
                    ? `${daySummary.under} under`
                    : daySummary.roleMismatch > 0
                      ? `${daySummary.roleMismatch} role`
                      : daySummary.over > 0
                        ? `${daySummary.over} over`
                        : "matched"}
                </small>
              </button>
            );
          })}
        </div>

        {!rows.length ? (
          <div className="rota-empty-state">
            <h3>No staffing recommendation available</h3>
            <p>
              Add business setup and forecast data first, then ScheduleLoop can
              compare the rota against recommended cover.
            </p>
          </div>
        ) : (
          <div className="coverage-summary">
            <div className="coverage-summary-header">
              <div>
                <h3>{selectedDay.label} coverage</h3>
                <p>
                  Coverage is calculated from scheduled shift times. Unpaid
                  breaks reduce paid hours and labour cost but are not assigned
                  to a specific coverage period.
                </p>
              </div>
              <div className="coverage-status-counts">
                <span>{summary.matched} matched</span>
                <span>{summary.under} under</span>
                <span>{summary.roleMismatch} role mismatch</span>
                <span>{summary.over} over</span>
              </div>
            </div>

            {summary.needsAttention === 0 && (
              <p className="coverage-positive">
                This day matches the staffing recommendation.
              </p>
            )}

            <div className="coverage-table" role="table" aria-label="Coverage comparison">
              <div className="coverage-row coverage-row-head" role="row">
                <span>Period</span>
                <span>Recommended</span>
                <span>Scheduled</span>
                <span>Difference</span>
                <span>Status</span>
                <span>Role detail</span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.hour}
                  className={`coverage-row coverage-${row.status}`}
                  role="row"
                >
                  <span>
                    {row.hour}-{row.endHour}
                  </span>
                  <span>{formatCoverageValue(row.recommendedTotal)}</span>
                  <span>{formatCoverageValue(row.scheduledTotal)}</span>
                  <span>{formatDifferenceLabel(row.difference)}</span>
                  <span>{row.statusLabel}</span>
                  <span>{formatRoleIssues(row)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </InfoCard>
    </section>
  );
}

export function CopyPreviousWeekDialog({
  open,
  loading,
  saving,
  analysis,
  error,
  report,
  previousWeekLabel,
  onCopySafe,
  onReplace,
  onClose,
}) {
  if (!open) return null;

  const summary = analysis?.summary;
  const skippedRows = analysis?.skippedShifts || [];

  return (
    <RotaDialog
      title="Copy previous week"
      subtitle={`Review shifts from ${previousWeekLabel} before copying them into this week.`}
      wide
      onClose={onClose}
    >
      {loading ? (
        <div className="rota-empty-state">
          <h3>Checking previous week</h3>
          <p>Looking for duplicates, overlaps, inactive employees, and missing staff.</p>
        </div>
      ) : error ? (
        <div className="banner banner-error">{error}</div>
      ) : (
        <>
          {summary && (
            <div className="copy-summary-grid">
              <div>
                <span>Previous week</span>
                <strong>{summary.totalPrevious}</strong>
              </div>
              <div>
                <span>Safe to copy</span>
                <strong>{summary.safe}</strong>
              </div>
              <div>
                <span>Existing this week</span>
                <strong>{summary.existingTargetShifts}</strong>
              </div>
              <div>
                <span>Duplicates</span>
                <strong>{summary.exactDuplicates}</strong>
              </div>
              <div>
                <span>Overlaps</span>
                <strong>{summary.overlaps}</strong>
              </div>
              <div>
                <span>Inactive/missing</span>
                <strong>{summary.inactiveEmployees + summary.missingEmployees}</strong>
              </div>
            </div>
          )}

          {skippedRows.length > 0 && (
            <div className="copy-issue-list">
              <h3>Skipped shifts</h3>
              {skippedRows.slice(0, 8).map((row) => (
                <p key={`${row.shift.employeeId}-${row.shift.date}-${row.index}`}>
                  {row.shift.date} {row.shift.startTime}-{row.shift.endTime}:{" "}
                  {row.issueLabels.join(", ")}
                </p>
              ))}
              {skippedRows.length > 8 && (
                <p>{skippedRows.length - 8} more shift checks hidden.</p>
              )}
            </div>
          )}

          {report && <div className="banner banner-success">{report}</div>}

          <div className="rota-form-actions">
            <button
              type="button"
              className="primary-action-button"
              disabled={saving || !summary || summary.safe === 0}
              onClick={onCopySafe}
            >
              Copy safe shifts only
            </button>
            <button
              type="button"
              className="secondary-button danger-light"
              disabled={saving || !summary || summary.totalPrevious === 0}
              onClick={onReplace}
            >
              Replace current week
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </RotaDialog>
  );
}

export function PrintableRota({
  businessName,
  location,
  weekStart,
  weekStatus,
  weekDays,
  shifts,
  employees,
  roles,
  employeeHours,
  weeklyHours,
}) {
  const scheduledEmployees = employees.filter((employee) =>
    shifts.some((shift) => shift.employeeId === employee.id)
  );

  return (
    <section className="rota-print-sheet" aria-label="Printable rota">
      <header>
        <p>ScheduleLoop rota</p>
        <h1>{businessName}</h1>
        {location && <p>{location}</p>}
        <p>
          Week {getWeekRangeLabel(weekStart)} -{" "}
          {weekStatus === ROTA_STATUS.published ? "Published" : "Draft"}
        </p>
      </header>

      {scheduledEmployees.length === 0 ? (
        <p>No shifts scheduled yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {weekDays.map((day) => (
                <th key={day.dateKey}>{day.shortLabel}</th>
              ))}
              <th>Week</th>
            </tr>
          </thead>
          <tbody>
            {scheduledEmployees.map((employee) => (
              <tr key={employee.id}>
                <th scope="row">{employee.displayName}</th>
                {weekDays.map((day) => {
                  const cellShifts = shifts
                    .filter(
                      (shift) =>
                        shift.employeeId === employee.id && shift.date === day.dateKey
                    )
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));

                  return (
                    <td key={day.dateKey}>
                      {cellShifts.length === 0
                        ? "-"
                        : cellShifts.map((shift) => (
                            <div key={shift.id || `${shift.date}-${shift.startTime}`}>
                              <strong>
                                {shift.startTime}-{shift.endTime}
                              </strong>
                              <span>{getRoleName(roles, shift.roleId)}</span>
                              {normalizeBreakMinutes(shift.breakMinutes) > 0 && (
                                <span>{normalizeBreakMinutes(shift.breakMinutes)} min break</span>
                              )}
                            </div>
                          ))}
                    </td>
                  );
                })}
                <td>{formatHours(employeeHours[employee.id] || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total hours</th>
              <td colSpan={weekDays.length + 1}>{formatHours(weeklyHours)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
