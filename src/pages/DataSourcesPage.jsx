import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import InfoCard from "../components/InfoCard";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import {
  createSquareOAuthUrl,
  disconnectSquare,
  getSquareIntegrationEnabled,
  syncSquareHistory,
} from "../integrations/pos/posClient";
import { subscribeToPosConnection } from "../integrations/pos/posConnectionService";
import {
  getDemandSourceLabel,
  getForecastDemandModel,
} from "../integrations/pos/demandSources";

const SQUARE_PROVIDER = "square";

function formatDateTime(value) {
  if (!value) return "Not yet";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getConnectionStatus(connection) {
  const status = connection?.connectionStatus || "disconnected";
  if (status === "connected") return "Connected";
  if (status === "syncing") return "Syncing";
  if (status === "problem") return "Connection problem";
  return "Not connected";
}

function DataSourceStatus({ type, text }) {
  if (!text) return null;

  return (
    <p
      className={`settings-status ${
        type === "error" ? "settings-status-error" : "settings-status-success"
      }`}
      role={type === "error" ? "alert" : "status"}
    >
      {text}
    </p>
  );
}

function ComingSoonProvider({ name }) {
  return (
    <article className="data-source-row muted">
      <div>
        <h3>{name}</h3>
        <p>Additional POS providers can plug into the same demand pipeline later.</p>
      </div>
      <span className="data-source-pill">Coming soon</span>
    </article>
  );
}

function DataSourcesPage() {
  const { businessId, membership, profile } = useBusinessProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [squareConnection, setSquareConnection] = useState(null);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [busyAction, setBusyAction] = useState("");
  const squareEnabled = getSquareIntegrationEnabled();
  const forecastDemand = useMemo(() => getForecastDemandModel(profile), [profile]);
  const canManage = ["owner", "admin", "manager"].includes(
    String(membership?.role || "").toLowerCase()
  );
  const isConnected = squareConnection?.connectionStatus === "connected";
  const isSyncing = squareConnection?.connectionStatus === "syncing";

  useEffect(() => {
    return subscribeToPosConnection({
      businessId,
      provider: SQUARE_PROVIDER,
      onNext: setSquareConnection,
      onError: () =>
        setMessage({
          type: "error",
          text: "We could not load Square connection status.",
        }),
    });
  }, [businessId]);

  useEffect(() => {
    const squareResult = searchParams.get("square");
    if (!squareResult) return;

    if (squareResult === "connected") {
      setMessage({ type: "success", text: "Square connected successfully." });
    } else if (squareResult === "denied") {
      setMessage({ type: "error", text: "Square connection was cancelled." });
    } else {
      setMessage({
        type: "error",
        text: "Square could not be connected. Try again from this page.",
      });
    }

    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleConnectSquare = async () => {
    setMessage({ type: "", text: "" });
    setBusyAction("connect");
    try {
      const url = await createSquareOAuthUrl(businessId);
      window.location.assign(url);
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      setMessage({
        type: "error",
        text: "Square is not ready to connect yet. Check the setup and try again.",
      });
      setBusyAction("");
    }
  };

  const handleSyncSquare = async () => {
    setMessage({ type: "", text: "" });
    setBusyAction("sync");
    try {
      const result = await syncSquareHistory(businessId, 30);
      setMessage({
        type: "success",
        text: `Square sync finished. Imported ${result.processed || 0} new or updated transactions.`,
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      setMessage({
        type: "error",
        text: "We're having trouble syncing Square right now. Your existing ScheduleLoop data is safe.",
      });
    } finally {
      setBusyAction("");
    }
  };

  const handleDisconnectSquare = async () => {
    const confirmed = window.confirm(
      "Disconnect Square from ScheduleLoop? Historical demand already imported into ScheduleLoop will be kept."
    );
    if (!confirmed) return;

    setMessage({ type: "", text: "" });
    setBusyAction("disconnect");
    try {
      await disconnectSquare(businessId);
      setMessage({
        type: "success",
        text: "Square disconnected. Existing ScheduleLoop history was kept.",
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      setMessage({
        type: "error",
        text: "Square could not be disconnected. Try again or contact support.",
      });
    } finally {
      setBusyAction("");
    }
  };

  return (
    <main className="data-sources-page">
      <section className="settings-hero">
        <div>
          <p className="section-kicker">Data sources</p>
          <h2>Connect your business data to ScheduleLoop</h2>
          <p>
            Use CSV uploads or a Square POS connection to keep demand history
            flowing into the same forecast pipeline.
          </p>
        </div>
        <div className="settings-hero-card">
          <span>Forecast source</span>
          <strong>{getDemandSourceLabel(forecastDemand.source)}</strong>
          <p>
            {forecastDemand.overlapPolicy === "csv_preferred"
              ? "CSV remains the active forecast source while Square history is kept separately."
              : "Forecasting maths and rota behaviour are unchanged."}
          </p>
        </div>
      </section>

      <DataSourceStatus type={message.type} text={message.text} />

      <div className="data-sources-grid">
        <InfoCard
          title="Live POS"
          subtitle="Square can automatically send operational sales activity to ScheduleLoop."
          className="settings-card"
        >
          <article className="data-source-row">
            <div>
              <h3>Square</h3>
              <p>
                Automatically sync transactions from Square POS without storing
                payment card or customer contact details.
              </p>
            </div>
            <span
              className={`data-source-pill ${
                isConnected ? "success" : isSyncing ? "warning" : ""
              }`}
            >
              {getConnectionStatus(squareConnection)}
            </span>
          </article>

          {squareConnection && (
            <dl className="data-source-meta">
              <div>
                <dt>Last sync</dt>
                <dd>{formatDateTime(squareConnection.lastSuccessfulSyncAt)}</dd>
              </div>
              <div>
                <dt>Last Square event</dt>
                <dd>{formatDateTime(squareConnection.lastWebhookAt)}</dd>
              </div>
              <div>
                <dt>Locations mapped</dt>
                <dd>{squareConnection.connectedLocations?.length || 0}</dd>
              </div>
            </dl>
          )}

          {!squareEnabled && (
            <p className="settings-muted-note">
              Square is hidden until the Firebase Functions and Square sandbox
              settings are configured.
            </p>
          )}

          <div className="settings-button-row">
            {!isConnected ? (
              <button
                type="button"
                className="primary-action-button"
                onClick={handleConnectSquare}
                disabled={!squareEnabled || !canManage || busyAction === "connect"}
              >
                {busyAction === "connect" ? "Connecting..." : "Connect Square"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-action-button"
                  onClick={handleSyncSquare}
                  disabled={!canManage || busyAction === "sync" || isSyncing}
                >
                  {busyAction === "sync" || isSyncing ? "Syncing..." : "Sync recent history"}
                </button>
                <button
                  type="button"
                  className="secondary-button danger-light"
                  onClick={handleDisconnectSquare}
                  disabled={!canManage || busyAction === "disconnect"}
                >
                  {busyAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </button>
              </>
            )}
          </div>
        </InfoCard>

        <InfoCard
          title="Manual fallback"
          subtitle="CSV upload stays fully supported for businesses without Square."
          className="settings-card"
        >
          <article className="data-source-row">
            <div>
              <h3>CSV Upload</h3>
              <p>
                Upload historical trading data manually. This path continues to
                use the existing validation and backtesting flow.
              </p>
            </div>
            <Link className="secondary-button" to="/?view=setup#data-imports">
              Upload CSV
            </Link>
          </article>
        </InfoCard>

        <InfoCard
          title="Future providers"
          subtitle="The POS layer is provider-neutral, but these integrations are not live yet."
          className="settings-card"
        >
          <div className="data-source-provider-list">
            <ComingSoonProvider name="Epos Now" />
            <ComingSoonProvider name="Lightspeed" />
          </div>
        </InfoCard>
      </div>
    </main>
  );
}

export default DataSourcesPage;
