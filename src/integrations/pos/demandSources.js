import {
  CSV_DEMAND_MODEL_VERSION,
  isCurrentCsvDemandModel,
} from "../../utils/demandModel.js";

const CURRENT_POS_DEMAND_MODEL_VERSION = CSV_DEMAND_MODEL_VERSION;

export const FORECAST_DEMAND_SOURCES = Object.freeze({
  CSV: "csv",
  SQUARE: "square",
  PRESET: "preset",
});

function isCurrentPosDemandModel(posDemand) {
  return posDemand?.modelVersion === CURRENT_POS_DEMAND_MODEL_VERSION;
}

export function getForecastDemandModel(profile) {
  const csvDemand = isCurrentCsvDemandModel(profile?.csvDemand)
    ? profile.csvDemand
    : null;
  const posDemand = isCurrentPosDemandModel(profile?.posDemand)
    ? profile.posDemand
    : null;

  if (csvDemand) {
    return {
      model: csvDemand,
      source: FORECAST_DEMAND_SOURCES.CSV,
      hasPosDemand: Boolean(posDemand?.rows),
      overlapPolicy: posDemand?.rows ? "csv_preferred" : "none",
    };
  }

  if (posDemand?.rows) {
    return {
      model: posDemand,
      source: FORECAST_DEMAND_SOURCES.SQUARE,
      hasPosDemand: true,
      overlapPolicy: "pos_only",
    };
  }

  return {
    model: null,
    source: FORECAST_DEMAND_SOURCES.PRESET,
    hasPosDemand: Boolean(posDemand?.rows),
    overlapPolicy: "none",
  };
}

export function getDemandSourceLabel(source) {
  if (source === FORECAST_DEMAND_SOURCES.SQUARE) return "Square";
  if (source === FORECAST_DEMAND_SOURCES.CSV) return "CSV upload";
  return "Business profile";
}
