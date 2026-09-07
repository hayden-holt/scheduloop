// Convert only the Square input boundary to seller wall time. The existing
// bucket and forecasting calculations continue to receive their local-time input.
export function getSquareLocalTimestamp(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Square payment timestamp.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute + ":" + parts.second;
}
