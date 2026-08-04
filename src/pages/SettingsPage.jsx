import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import InfoCard from "../components/InfoCard";
import { useAuth } from "../auth/AuthContext";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import { HOURS, isOpeningHoursValid } from "../utils/schedule";
import {
  canRequestPasswordReset,
  getFriendlyAuthErrorMessage,
} from "../utils/authErrors";
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
  const {
    user,
    resetPassword,
    updateUserEmail,
    updateUserPassword,
  } = useAuth();
  const { profile, saveProfile } = useBusinessProfile();
  const initialBasics = normalizeBusinessProfileBasics(profile || {});
  const initialHours = normalizeOpeningHours(profile?.hours);
  const initialDemandEstimates = normalizeDemandEstimates(
    profile?.demandEstimates,
    initialBasics.businessType
  );

  const [email, setEmail] = useState(user?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState({ type: "", text: "" });
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

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
    setEmail(user?.email || "");
  }, [user?.email]);

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

  const handleEmailSave = async (event) => {
    event.preventDefault();
    setAccountMessage({ type: "", text: "" });

    const trimmedEmail = email.trim();
    if (!canRequestPasswordReset(trimmedEmail)) {
      setAccountMessage({
        type: "error",
        text: "Enter a valid email address.",
      });
      return;
    }

    if (trimmedEmail === user?.email) {
      setAccountMessage({
        type: "success",
        text: "This is already your sign-in email.",
      });
      return;
    }

    setIsSavingEmail(true);
    try {
      await updateUserEmail(trimmedEmail);
      setAccountMessage({
        type: "success",
        text: "Your sign-in email has been updated.",
      });
    } catch (error) {
      console.error(error);
      setAccountMessage({
        type: "error",
        text: getFriendlyAuthErrorMessage(
          error,
          "We could not update your email. Please try again."
        ),
      });
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handlePasswordSave = async (event) => {
    event.preventDefault();
    setAccountMessage({ type: "", text: "" });

    if (newPassword.length < 8) {
      setAccountMessage({
        type: "error",
        text: "Use a stronger password with at least 8 characters.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setAccountMessage({
        type: "error",
        text: "The password fields do not match.",
      });
      return;
    }

    setIsSavingPassword(true);
    try {
      await updateUserPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setAccountMessage({
        type: "success",
        text: "Your password has been updated.",
      });
    } catch (error) {
      console.error(error);
      setAccountMessage({
        type: "error",
        text: getFriendlyAuthErrorMessage(
          error,
          "We could not update your password. Please try again."
        ),
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleResetLink = async () => {
    setAccountMessage({ type: "", text: "" });

    const resetEmail = user?.email || email.trim();
    if (!canRequestPasswordReset(resetEmail)) {
      setAccountMessage({
        type: "error",
        text: "Add a valid sign-in email before sending a reset link.",
      });
      return;
    }

    setIsSendingReset(true);
    try {
      await resetPassword(resetEmail);
      setAccountMessage({
        type: "success",
        text: "A password reset link has been sent to your sign-in email.",
      });
    } catch (error) {
      console.error(error);
      setAccountMessage({
        type: "error",
        text: getFriendlyAuthErrorMessage(
          error,
          "We could not send a reset link. Please try again."
        ),
      });
    } finally {
      setIsSendingReset(false);
    }
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
      console.error(error);
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
            title="Account"
            subtitle="Manage the email and password used to sign in."
            className="settings-card"
          >
            <form className="settings-form" onSubmit={handleEmailSave}>
              <label className="settings-field" htmlFor="settings-email">
                Sign-in email
                <span>Use an address the account owner can access.</span>
              </label>
              <div className="settings-action-row">
                <input
                  id="settings-email"
                  className="settings-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={isSavingEmail}
                >
                  {isSavingEmail ? "Saving..." : "Update email"}
                </button>
              </div>
            </form>

            <form className="settings-form" onSubmit={handlePasswordSave}>
              <div className="settings-field-grid two">
                <label className="settings-field" htmlFor="settings-password">
                  New password
                  <span>Use at least 8 characters.</span>
                  <input
                    id="settings-password"
                    className="settings-input"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>

                <label
                  className="settings-field"
                  htmlFor="settings-password-confirm"
                >
                  Confirm password
                  <span>Re-enter it to avoid mistakes.</span>
                  <input
                    id="settings-password-confirm"
                    className="settings-input"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    autoComplete="new-password"
                  />
                </label>
              </div>

              <div className="settings-button-row">
                <button
                  type="submit"
                  className="primary-action-button"
                  disabled={isSavingPassword}
                >
                  {isSavingPassword ? "Updating..." : "Update password"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleResetLink}
                  disabled={isSendingReset}
                >
                  {isSendingReset ? "Sending..." : "Send reset link"}
                </button>
              </div>
            </form>

            <SettingsStatus message={accountMessage} />
            <p className="settings-muted-note">
              Firebase may ask you to log in again before sensitive account
              changes. That protects the business account from stale sessions.
            </p>
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
              <li>Business settings are saved under your user ID.</li>
              <li>CSV uploads and rota data stay in their existing areas.</li>
              <li>Changing account email or password may require a fresh login.</li>
            </ul>
          </InfoCard>
        </aside>
      </div>
    </main>
  );
}

export default SettingsPage;
