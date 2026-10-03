import InfoCard from "../components/InfoCard";
import { formatCurrencyGBP } from "../utils/labourCost";
import { getCoverageSummary } from "../utils/rota";
import { parseLocalDateKey, toLocalDateKey } from "../utils/schedule";
import { summarizeRotaDay } from "./monthlyRota";
import "./RotaMonth.css";

export default function RotaMonth({
  month,
  shiftsByDate,
  employees,
  roles,
  averageHourlyWage,
  coverageByDate,
  selectedDate,
  onOpenDay,
}) {
  const today = toLocalDateKey(new Date());
  const trailingDays = (7 - ((month.leadingDays + month.days.length) % 7)) % 7;
  return (
    <InfoCard
      title="Monthly rota"
      subtitle="Select a day to open its weekly rota and edit shifts. Labour figures are estimates; coverage checks use the existing forecast."
      className="rota-month-card"
    >
      <div className="rota-month-grid" aria-label={month.label}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div className="rota-month-weekday" key={day}>
            {day}
          </div>
        ))}
        {Array.from({ length: month.leadingDays }, (_, index) => (
          <div
            className="rota-month-blank"
            key={`before-${index}`}
            aria-hidden="true"
          />
        ))}
        {month.days.map(({ dateKey, day }) => {
          const summary = summarizeRotaDay({
            shifts: shiftsByDate[dateKey] || [],
            employees,
            roles,
            averageHourlyWage,
          });
          const coverage = getCoverageSummary(coverageByDate[dateKey] || []);
          const dateLabel = parseLocalDateKey(dateKey).toLocaleDateString(
            undefined,
            { weekday: "long", day: "numeric", month: "long", year: "numeric" }
          );
          const labour =
            summary.labourCost === null
              ? "Wage data missing"
              : `${formatCurrencyGBP(summary.labourCost)} labour`;
          const checks = coverage.needsAttention
            ? `${coverage.needsAttention} periods to review`
            : coverage.hasCoverage
              ? "Coverage matched"
              : "No forecast";
          return (
            <button
              type="button"
              key={dateKey}
              className={`rota-month-day${selectedDate === dateKey ? " selected" : ""}`}
              aria-current={today === dateKey ? "date" : undefined}
              aria-label={`${dateLabel}: ${summary.staffCount} staff, ${summary.shiftCount} shifts, ${labour}, ${checks}. Open week.`}
              onClick={() => onOpenDay(dateKey)}
            >
              <strong className="rota-month-date">
                {day}
                <span>{today === dateKey ? "Today" : ""}</span>
              </strong>
              <span>{summary.staffCount} staff</span>
              <span>
                {summary.shiftCount}{" "}
                {summary.shiftCount === 1 ? "shift" : "shifts"}
              </span>
              <span className="rota-month-detail">{labour}</span>
              <small
                className={
                  coverage.needsAttention
                    ? "rota-month-warning"
                    : "rota-month-detail"
                }
              >
                <span className="rota-month-full-check">{checks}</span>
                <span className="rota-month-short-check">
                  {coverage.needsAttention
                    ? `${coverage.needsAttention} checks`
                    : ""}
                </span>
              </small>
            </button>
          );
        })}
        {Array.from({ length: trailingDays }, (_, index) => (
          <div
            className="rota-month-blank"
            key={`after-${index}`}
            aria-hidden="true"
          />
        ))}
      </div>
    </InfoCard>
  );
}
