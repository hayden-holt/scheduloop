import { useMemo, useState } from "react";
import { TOTAL_FEEDBACK_ROLE_ID } from "../utils/staffingFeedback";

const FEEDBACK_BUTTONS = [
  { value: "overstaffed", label: "Overstaffed" },
  { value: "right", label: "About right" },
  { value: "understaffed", label: "Understaffed" },
];

function ForecastFeedbackPanel({
  selectedDate,
  chartData = [],
  roles = [],
  feedbackEntries = [],
  onFeedbackSave,
}) {
  const firstHour = chartData?.[0]?.hour || "";
  const [selectedHour, setSelectedHour] = useState(firstHour);
  const [selectedRoleId, setSelectedRoleId] = useState(TOTAL_FEEDBACK_ROLE_ID);
  const [actualStaff, setActualStaff] = useState("");

  const selectedPoint = useMemo(() => {
    const matchingPoint = chartData.find((point) => point.hour === selectedHour);
    return matchingPoint || chartData[0] || null;
  }, [chartData, selectedHour]);
  const safeSelectedRoleId =
    selectedRoleId === TOTAL_FEEDBACK_ROLE_ID ||
    roles.some((role) => role.id === selectedRoleId)
      ? selectedRoleId
      : TOTAL_FEEDBACK_ROLE_ID;

  if (!selectedPoint) return null;

  const safeSelectedHour = selectedPoint.hour;
  const predictedStaff =
    safeSelectedRoleId === TOTAL_FEEDBACK_ROLE_ID
      ? selectedPoint.total
      : selectedPoint[safeSelectedRoleId];
  const existingFeedback = feedbackEntries.find(
    (entry) =>
      entry?.date === selectedDate &&
      entry.hour === safeSelectedHour &&
      (entry.roleId || TOTAL_FEEDBACK_ROLE_ID) === safeSelectedRoleId
  );

  const handleSave = (feedback) => {
    onFeedbackSave({
      date: selectedDate,
      hour: safeSelectedHour,
      roleId: safeSelectedRoleId,
      predictedStaff,
      actualStaff: actualStaff === "" ? predictedStaff : Number(actualStaff),
      feedback,
    });
  };

  return (
    <div className="forecast-feedback-panel">
      <div className="forecast-feedback-header">
        <div>
          <h3>Forecast review</h3>
          <p>
            After a shift, record whether one hour felt high, right, or low.
            ScheduleLoop uses this gently on similar days.
          </p>
        </div>
        <span className="forecast-feedback-badge">Manager feedback</span>
      </div>

      <div className="forecast-feedback-controls">
        <label className="forecast-feedback-field">
          <span>Hour</span>
          <select
            value={safeSelectedHour}
            onChange={(event) => setSelectedHour(event.target.value)}
          >
            {chartData.map((point) => (
              <option key={point.hour} value={point.hour}>
                {point.hour}
              </option>
            ))}
          </select>
        </label>

        <label className="forecast-feedback-field">
          <span>Staff area</span>
          <select
            value={safeSelectedRoleId}
            onChange={(event) => setSelectedRoleId(event.target.value)}
          >
            <option value={TOTAL_FEEDBACK_ROLE_ID}>Total staff</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <label className="forecast-feedback-field">
          <span>Actual staff</span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder={String(predictedStaff ?? 0)}
            value={actualStaff}
            onChange={(event) => setActualStaff(event.target.value)}
          />
        </label>
      </div>

      <div className="forecast-feedback-footer">
        <div className="forecast-feedback-predicted">
          <span>Predicted</span>
          <strong>{predictedStaff ?? 0} staff</strong>
        </div>

        <div className="forecast-feedback-actions">
          {FEEDBACK_BUTTONS.map((button) => (
            <button
              key={button.value}
              type="button"
              className={
                `feedback-action feedback-action-${button.value}` +
                (existingFeedback?.feedback === button.value ? " active" : "")
              }
              onClick={() => handleSave(button.value)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ForecastFeedbackPanel;
