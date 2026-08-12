import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import InfoCard from "../components/InfoCard";
import { useAuth } from "../auth/AuthContext";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import { HOURS, isOpeningHoursValid } from "../utils/schedule";
import {
  BUSINESS_RHYTHM_OPTIONS,
  CUSTOMER_PATTERN_OPTIONS,
  getBusinessRhythmForCustomerPattern,
  getBusinessSubtypeOptions,
  getDefaultBusinessSubtype,
  getDemandUnitLabel,
  getDemandUnitOptions,
  normalizeBusinessProfileBasics,
  normalizeDemandEstimates,
  normalizeOpeningHours,
} from "../utils/businessProfileSetup";

const BUSY_LEVEL_OPTIONS = [
  { value: "quiet", label: "Quiet" },
  { value: "normal", label: "Normal" },
  { value: "busy", label: "Busy" },
  { value: "veryBusy", label: "Very busy" },
];

function getSelectedLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function getProfileSaveErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "Scheduloop could not save this profile change. Your business data was not changed.";
  }

  if (error?.code === "unavailable") {
    return "Scheduloop could not reach Firestore. Check your connection and try again.";
  }

  return "We could not save these settings. Please try again.";
}

function SettingsStatus({ message }) {
  if (!message?.text) return null;

  return (
    <p
      className={`settings-status ${
        message.type === "error" ? "settings-status-error" : "settings-status-success"
      }`}
      role={message.type === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  const { profile, saveProfile, membership, businessId } = useBusinessProfile();
  const initialBasics = normalizeBusinessProfileBasics(profile || {});
  const initialHours = normalizeOpeningHours(profile?.hours);
  const initialDemandEstimates = normalizeDemandEstimates(
    profile?.demandEstimates,
    initialBasics.businessType
  );

  const [businessName, setBusinessName] = useState(initialBasics.businessName);
  const [businessType, setBusinessType] = useState(initialBasics.businessType);
  const [businessSubtype, setBusinessSubtype] = useState(
    initialBasics.businessSubtype
  );
  const [location, setLocation] = useState(initialBasics.location);
  const [customerPattern, setCustomerPattern] = useState(
    initialBasics.customerPattern
  );
  const [businessRhythm, setBusinessRhythm] = useState(
    initialBasics.businessRhythm
  );
  const [busyLevel, setBusyLevel] = useState(profile?.busyLevel || "normal");
  const [openingHours, setOpeningHours] = useState(initialHours);
  const [demandEstimates, setDemandEstimates] = useState(
    initialDemandEstimates
  );
  const [profileMessage, setProfileMessage] = useState({ type: "", text: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    const basics = normalizeBusinessProfileBasics(profile || {});

    setBusinessName(basics.businessName);
    setBusinessType(basics.businessType);
    setBusinessSubtype(basics.businessSubtype);
    setLocation(basics.location);
    setCustomerPattern(basics.customerPattern);
    setBusinessRhythm(basics.businessRhythm);
    setBusyLevel(profile?.busyLevel || "normal");
    setOpeningHours(normalizeOpeningHours(profile?.hours));
    setDemandEstimates(
      normalizeDemandEstimates(profile?.demandEstimates, basics.businessType)
    );
  }, [profile]);

  const subtypeOptions = useMemo(
    () => getBusinessSubtypeOptions(businessType),
    [businessType]
  );
  const demandUnitOptions = useMemo(
    () => getDemandUnitOptions(businessType),
    [businessType]
  );
  const safeDemandEstimates = useMemo(
    () => normalizeDemandEstimates(demandEstimates, businessType),
    [demandEstimates, businessType]
  );
  const demandUnitLabel = getDemandUnitLabel(
    businessType,
    safeDemandEstimates.unit
  );
  const weekdayHoursValid = isOpeningHoursValid(openingHours);
  const weekendHoursValid =
    !openingHours.weekend.enabled ||
    isOpeningHoursValid(openingHours.weekend);
  const openingHoursValid = weekdayHoursValid && weekendHoursValid;
  const selectedSubtypeLabel = getSelectedLabel(
    subtypeOptions,
    businessSubtype
  );

  const handleBusinessTypeChange = (nextType) => {
    const nextSubtype = getDefaultBusinessSubtype(nextType);
    setBusinessType(nextType);
    setBusinessSubtype(nextSubtype);
    setDemandEstimates((prev) => normalizeDemandEstimates(prev, nextType));
  };

  const handleCustomerPatternChange = (nextPattern) => {
    setCustomerPattern(nextPattern);
    setBusinessRhythm(getBusinessRhythmForCustomerPattern(nextPattern));
  };

  const handleDemandEstimateChange = (key, value) => {
    setDemandEstimates((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    setProfileMessage({ type: "", text: "" });

    if (!businessName.trim()) {
      setProfileMessage({
        type: "error",
        text: "Add a business name before saving.",
      });
      return;
    }

    if (!openingHoursValid) {
      setProfileMessage({
        type: "error",
        text: "Closing time must be later than opening time.",
      });
      return;
    }

    const safeSubtype = subtypeOptions.some(
      (option) => option.value === businessSubtype
    )
      ? businessSubtype
      : getDefaultBusinessSubtype(businessType);

    setIsSavingProfile(true);
    try {
      await saveProfile({
        businessName: businessName.trim(),
        businessType,
        businessSubtype: safeSubtype,
        location: location.trim(),
        customerPattern,
        businessRhythm,
        demandEstimates: safeDemandEstimates,
        hours: normalizeOpeningHours(openingHours),
        busyLevel,
      });
      setProfileMessage({
        type: "success",
        text: "Settings saved. Your dashboard will use this profile.",
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      setProfileMessage({
        type: "error",
        text: getProfileSaveErrorMessage(error),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <main className="settings-page">
      <section className="settings-hero">
        <div>
          <p className="section-kicker">Account and profile</p>
          <h2>Manage your Scheduloop settings</h2>
          <p>
            Keep the account and business details behind your forecasts up to
            date. These changes use the same saved profile as onboarding.
          </p>
        </div>
        <div className="settings-hero-card">
          <span>Current profile</span>
          <strong>{businessName || "My business"}</strong>
          <p>
            {selectedSubtypeLabel}
            {location ? ` - ${location}` : ""}
          </p>
        </div>
      </section>

      <div className="settings-layout">
        <div className="settings-column">
          <InfoCard
            title="Account access"
            subtitle="ScheduleLoop uses Firebase email-link sign-in and manual workspace membership."
            className="settings-card"
          >
            <dl className="settings-definition-list">
              <div>
                <dt>Signed-in email</dt>
                <dd>{user?.email || "Unknown"}</dd>
              </div>
              <div>
                <dt>Workspace role</dt>
                <dd>{membership?.legacy ? "owner (legacy)" : membership?.role || "manager"}</dd>
              </div>
              <div>
                <dt>Workspace ID</dt>
                <dd>{businessId || "Not available"}</dd>
              </div>
            </dl>
            <p className="settings-muted-note">
              Passwords are no longer used in the app. To change the email or
              remove access, contact ScheduleLoop support so the Firebase user
              and workspace membership can be updated together.
            </p>
            <div className="settings-link-list compact">
              <Link to="/privacy">
                <strong>Privacy notice</strong>
                <span>How ScheduleLoop handles account and business data.</span>
              </Link>
              <Link to="/terms">
                <strong>Terms</strong>
                <span>The draft application terms for business users.</span>
              </Link>
            </div>
          </InfoCard>

          <InfoCard
            title="Business details"
            subtitle="These are the basic details Scheduloop shows and saves with your operating profile."
            className="settings-card"
          >
            <form className="settings-form" onSubmit={handleProfileSave}>
              <div className="settings-field-grid two">
                <label className="settings-field" htmlFor="settings-business-name">
                  Business name
                  <span>Shown across your saved profile and dashboard.</span>
                  <input
                    id="settings-business-name"
                    className="settings-input"
                    type="text"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    placeholder="e.g. Riverside Coffee"
                  />
                </label>

                <label className="settings-field" htmlFor="settings-location">
                  Town or city
                  <span>Optional, useful when reviewing plans.</span>
                  <input
                    id="settings-location"
                    className="settings-input"
                    type="text"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>

              <div className="settings-field-grid two">
                <label className="settings-field" htmlFor="settings-business-type">
                  Business type
                  <span>Keep this aligned with how the business operates.</span>
                  <select
                    id="settings-business-type"
                    className="settings-select"
                    value={businessType}
                    onChange={(event) =>
                      handleBusinessTypeChange(event.target.value)
                    }
                  >
                    <option value="cafe">Cafe / Restaurant</option>
                    <option value="gym">Gym / Fitness</option>
                  </select>
                </label>

                <label
                  className="settings-field"
                  htmlFor="settings-business-subtype"
                >
                  Business subtype
                  <span>Used as context for the starting profile.</span>
                  <select
                    id="settings-business-subtype"
                    className="settings-select"
                    value={businessSubtype}
                    onChange={(event) =>
                      setBusinessSubtype(event.target.value)
                    }
                  >
                    {subtypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="settings-divider" />

              <section className="settings-mini-section">
                <div>
                  <h3>Opening hours</h3>
                  <p>These hours set the trading window for the forecast.</p>
                </div>

                <div className="settings-field-grid two">
                  <label className="settings-field" htmlFor="settings-open">
                    Weekday opens
                    <select
                      id="settings-open"
                      className="settings-select"
                      value={openingHours.open}
                      onChange={(event) =>
                        setOpeningHours((prev) => ({
                          ...prev,
                          open: event.target.value,
                        }))
                      }
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field" htmlFor="settings-close">
                    Weekday closes
                    <select
                      id="settings-close"
                      className="settings-select"
                      value={openingHours.close}
                      onChange={(event) =>
                        setOpeningHours((prev) => ({
                          ...prev,
                          close: event.target.value,
                        }))
                      }
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={openingHours.weekend.enabled}
                    onChange={(event) =>
                      setOpeningHours((prev) => ({
                        ...prev,
                        weekend: {
                          ...prev.weekend,
                          enabled: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>Use different weekend hours</span>
                </label>

                {openingHours.weekend.enabled && (
                  <div className="settings-field-grid two">
                    <label
                      className="settings-field"
                      htmlFor="settings-weekend-open"
                    >
                      Weekend opens
                      <select
                        id="settings-weekend-open"
                        className="settings-select"
                        value={openingHours.weekend.open}
                        onChange={(event) =>
                          setOpeningHours((prev) => ({
                            ...prev,
                            weekend: {
                              ...prev.weekend,
                              open: event.target.value,
                            },
                          }))
                        }
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour}>
                            {hour}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label
                      className="settings-field"
                      htmlFor="settings-weekend-close"
                    >
                      Weekend closes
                      <select
                        id="settings-weekend-close"
                        className="settings-select"
                        value={openingHours.weekend.close}
                        onChange={(event) =>
                          setOpeningHours((prev) => ({
                            ...prev,
                            weekend: {
                              ...prev.weekend,
                              close: event.target.value,
                            },
                          }))
                        }
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour}>
                            {hour}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {!openingHoursValid && (
                  <p className="settings-status settings-status-error" role="alert">
                    Closing time must be later than opening time.
                  </p>
                )}
              </section>

              <div className="settings-divider" />

              <section className="settings-mini-section">
                <div>
                  <h3>Forecast starting point</h3>
                  <p>
                    These plain-English assumptions help before CSV history is
                    uploaded.
                  </p>
                </div>

                <div className="settings-field-grid two">
                  <label
                    className="settings-field"
                    htmlFor="settings-customer-pattern"
                  >
                    Typical customer pattern
                    <select
                      id="settings-customer-pattern"
                      className="settings-select"
                      value={customerPattern}
                      onChange={(event) =>
                        handleCustomerPatternChange(event.target.value)
                      }
                    >
                      {CUSTOMER_PATTERN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field" htmlFor="settings-rhythm">
                    Usually busiest
                    <select
                      id="settings-rhythm"
                      className="settings-select"
                      value={businessRhythm}
                      onChange={(event) => setBusinessRhythm(event.target.value)}
                    >
                      {BUSINESS_RHYTHM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="settings-field-grid two">
                  <label className="settings-field" htmlFor="settings-busy-level">
                    Typical day level
                    <select
                      id="settings-busy-level"
                      className="settings-select"
                      value={busyLevel}
                      onChange={(event) => setBusyLevel(event.target.value)}
                    >
                      {BUSY_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field" htmlFor="settings-demand-unit">
                    Demand estimate type
                    <select
                      id="settings-demand-unit"
                      className="settings-select"
                      value={safeDemandEstimates.unit}
                      onChange={(event) =>
                        handleDemandEstimateChange("unit", event.target.value)
                      }
                    >
                      {demandUnitOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="settings-field-grid three">
                  {[
                    { key: "quiet", label: "Quiet day" },
                    { key: "normal", label: "Normal day" },
                    { key: "busy", label: "Busy day" },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="settings-field"
                      htmlFor={`settings-demand-${item.key}`}
                    >
                      {item.label}
                      <input
                        id={`settings-demand-${item.key}`}
                        className="settings-input"
                        type="number"
                        min="0"
                        step="1"
                        value={demandEstimates[item.key] ?? ""}
                        placeholder={demandUnitLabel}
                        onChange={(event) =>
                          handleDemandEstimateChange(item.key, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>

              <div className="settings-button-row">
                <button
                  type="submit"
                  className="primary-action-button"
                  disabled={isSavingProfile || !openingHoursValid}
                >
                  {isSavingProfile ? "Saving..." : "Save business settings"}
                </button>
              </div>

              <SettingsStatus message={profileMessage} />
            </form>
          </InfoCard>
        </div>

        <aside className="settings-column">
          <InfoCard
            title="What stays elsewhere"
            subtitle="The specialist setup areas still live where managers expect them."
            className="settings-card"
          >
            <div className="settings-link-list">
              <Link to="/?view=setup#data-imports">
                <strong>Data and CSV imports</strong>
                <span>Upload trading history and review backtesting.</span>
              </Link>
              <Link to="/?view=setup#settings">
                <strong>Roles and forecasting rules</strong>
                <span>Edit staff roles, wages, buffers, prep, and close cover.</span>
              </Link>
              <Link to="/rota">
                <strong>Rota</strong>
                <span>Build the simple weekly rota from the forecast.</span>
              </Link>
            </div>
          </InfoCard>

          <InfoCard
            title="Profile safety"
            subtitle="These settings are saved to the signed-in owner's business profile."
            className="settings-card"
          >
            <ul className="settings-check-list">
              <li>Business settings are saved under the workspace ID.</li>
              <li>CSV uploads and rota data stay in their existing areas.</li>
              <li>Email or membership changes must be handled through support.</li>
            </ul>
          </InfoCard>
        </aside>
      </div>
    </main>
  );
}

export default SettingsPage;
