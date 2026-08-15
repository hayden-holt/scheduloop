import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import {
  DEFAULT_OPERATING_RULES,
  normalizeRolesForAccuracy,
} from "../config/businessPresets";
import { HOURS, isOpeningHoursValid } from "../utils/schedule";
import { normalizePositiveNumber, normalizeStaffCount } from "../utils/staffing";
import {
  BUSINESS_RHYTHM_OPTIONS,
  CUSTOMER_PATTERN_OPTIONS,
  applyBusinessRhythmToRoles,
  buildPeakStaffDefaults,
  deriveBusyLevelFromDemandEstimates,
  getBusinessRhythmForCustomerPattern,
  getBusinessSubtypeOptions,
  getDefaultBusinessSubtype,
  getDefaultRolesForBusinessProfile,
  getDemandUnitLabel,
  getDemandUnitOptions,
  normalizeBusinessProfileBasics,
  normalizeDemandEstimates,
  normalizeOpeningHours,
} from "../utils/businessProfileSetup";

const COLOR_OPTIONS = ["#4f8cff", "#3bd68b", "#ff776f", "#facc15", "#a855f7"];
const STEP_LABELS = [
  "Basics",
  "Hours",
  "Roles",
  "Staffing",
  "Accuracy",
  "Review",
];
const STEP_DESCRIPTIONS = [
  "Set the basics Scheduloop needs before the first forecast.",
  "Choose the hours Scheduloop should plan and staff around.",
  "Confirm the roles that shape your day-to-day cover.",
  "Set simple guardrails for minimum and peak cover.",
  "Add rough demand patterns so the first plan feels realistic.",
  "Check the profile before Scheduloop builds the first plan.",
];

function makeRoleId(name) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
}

function getBusinessTypeLabel(businessType) {
  return businessType === "cafe" ? "Cafe / Restaurant" : "Gym / Fitness";
}

function getSelectedLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function createCustomRole(name, color) {
  return {
    id: makeRoleId(name),
    name,
    description: "Custom role for this business.",
    color,
    curve: Array(HOURS.length).fill(1),
    serviceRate: 20,
    minStaff: 0,
    maxStaff: 0,
    demandWeight: 1,
    demandShare: 1,
    requiredDuringOpen: false,
    preferredDemandSource: "",
    hourlyWage: null,
  };
}

function getProfileSaveErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "Scheduloop could not save because database access needs updating for this profile version.";
  }

  if (error?.code === "unavailable") {
    return "Scheduloop could not reach Firestore. Check the connection and try again.";
  }

  return "We could not save your business profile. Please try again.";
}

function OnboardingPage() {
  const navigate = useNavigate();
  const { profile, saveProfile, completeOnboarding, needsOnboarding } =
    useBusinessProfile();
  const initialBasics = normalizeBusinessProfileBasics(profile || {});
  const initialOpeningHours = normalizeOpeningHours(profile?.hours);
  const initialDemandEstimates = normalizeDemandEstimates(
    profile?.demandEstimates,
    initialBasics.businessType
  );
  const initialRoles =
    profile?.roles && profile.roles.length > 0
      ? normalizeRolesForAccuracy(profile.roles)
      : getDefaultRolesForBusinessProfile(initialBasics);

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState(
    initialBasics.businessName === "My business"
      ? ""
      : initialBasics.businessName
  );
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
  const [roles, setRoles] = useState(initialRoles);
  const [openingHours, setOpeningHours] = useState(initialOpeningHours);
  const [demandEstimates, setDemandEstimates] = useState(
    initialDemandEstimates
  );
  const [busyLevel, setBusyLevel] = useState(profile?.busyLevel || "normal");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState(COLOR_OPTIONS[0]);
  const [peakStaff, setPeakStaff] = useState(() =>
    buildPeakStaffDefaults(initialRoles, profile?.peakStaff || {})
  );
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const subtypeOptions = getBusinessSubtypeOptions(businessType);
  const demandUnitOptions = getDemandUnitOptions(businessType);
  const weekdayHoursValid = isOpeningHoursValid(openingHours);
  const weekendHoursValid =
    !openingHours.weekend.enabled ||
    isOpeningHoursValid(openingHours.weekend);
  const openingHoursValid = weekdayHoursValid && weekendHoursValid;
  const safeDemandEstimates = useMemo(
    () => normalizeDemandEstimates(demandEstimates, businessType),
    [demandEstimates, businessType]
  );
  const demandUnitLabel = getDemandUnitLabel(
    businessType,
    safeDemandEstimates.unit
  );
  const totalPeakStaff = useMemo(
    () =>
      Object.values(peakStaff).reduce(
        (sum, value) => sum + normalizeStaffCount(value),
        0
      ),
    [peakStaff]
  );
  const progressPercent = ((step + 1) / STEP_LABELS.length) * 100;

  const resetRolesForProfile = (nextType, nextSubtype) => {
    const nextRoles = getDefaultRolesForBusinessProfile({
      businessType: nextType,
      businessSubtype: nextSubtype,
    });
    setRoles(nextRoles);
    setPeakStaff(buildPeakStaffDefaults(nextRoles, peakStaff));
  };

  const handleBusinessTypeSelect = (type) => {
    const nextSubtype = getDefaultBusinessSubtype(type);
    setBusinessType(type);
    setBusinessSubtype(nextSubtype);
    setDemandEstimates(normalizeDemandEstimates({}, type));
    resetRolesForProfile(type, nextSubtype);
  };

  const handleBusinessSubtypeChange = (value) => {
    setBusinessSubtype(value);
    resetRolesForProfile(businessType, value);
  };

  const handleCustomerPatternChange = (value) => {
    setCustomerPattern(value);
    setBusinessRhythm(getBusinessRhythmForCustomerPattern(value));
  };

  const handleAddRole = () => {
    const trimmed = newRoleName.trim();
    if (!trimmed) return;

    const newRole = createCustomRole(trimmed, newRoleColor);
    setRoles((prev) => [...prev, newRole]);
    setPeakStaff((prev) => ({
      ...prev,
      [newRole.id]: 1,
    }));
    setNewRoleName("");
  };

  const handleRemoveRole = (id) => {
    setRoles((prev) => prev.filter((role) => role.id !== id));
    setPeakStaff((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleRolePatch = (roleId, patch) => {
    setRoles((prev) =>
      prev.map((role) => (role.id === roleId ? { ...role, ...patch } : role))
    );
  };

  const handlePeakStaffChange = (roleId, value) => {
    setPeakStaff((prev) => ({
      ...prev,
      [roleId]: normalizeStaffCount(value),
    }));
  };

  const handleDemandEstimateChange = (key, value) => {
    setDemandEstimates((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleFinish = async () => {
    setSaveError("");
    setIsSaving(true);

    const normalizedOpeningHours = normalizeOpeningHours(openingHours);
    const normalizedDemandEstimates = normalizeDemandEstimates(
      demandEstimates,
      businessType
    );
    const rolesForForecast = applyBusinessRhythmToRoles(roles, businessRhythm);
    const businessProfile = {
      businessName: businessName.trim() || "My business",
      businessType,
      businessSubtype,
      location: location.trim(),
      customerPattern,
      businessRhythm,
      demandEstimates: normalizedDemandEstimates,
      roles: rolesForForecast,
      hours: normalizedOpeningHours,
      busyLevel: deriveBusyLevelFromDemandEstimates(
        normalizedDemandEstimates,
        busyLevel
      ),
      peakStaff,
      operatingRules: profile?.operatingRules || DEFAULT_OPERATING_RULES,
    };

    try {
      if (needsOnboarding) {
        await completeOnboarding(businessProfile);
      } else {
        await saveProfile(businessProfile);
      }
      navigate("/");
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      setSaveError(getProfileSaveErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canGoNext =
    (step === 0 && businessName.trim() && businessType) ||
    (step === 1 && openingHoursValid) ||
    (step === 2 && roles.length > 0) ||
    (step === 3 && roles.length > 0) ||
    step === 4 ||
    step === 5;

  const goNext = () => {
    if (step === STEP_LABELS.length - 1) {
      handleFinish();
    } else if (canGoNext) {
      setStep((s) => s + 1);
    }
  };

  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  return (
    <div className="app auth-screen onboarding-screen">
      <div className="auth-card onboarding-card onboarding-card-wide">
        <div className="onboarding-header">
          <div className="onboarding-header-copy">
            <p className="section-kicker">Scheduloop setup</p>
            <h1>Build your first operating profile</h1>
            <p className="subtitle">
              Tell us how your business usually runs. Scheduloop uses this to
              shape your first forecast before you upload trading history.
            </p>
          </div>

          <div className="onboarding-header-panel" aria-live="polite">
            <span>
              Step {step + 1} of {STEP_LABELS.length}
            </span>
            <strong>{STEP_LABELS[step]}</strong>
            <p>{STEP_DESCRIPTIONS[step]}</p>
          </div>
        </div>

        <div
          className="onboarding-progress"
          aria-hidden="true"
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="onboarding-steps" role="list">
          {STEP_LABELS.map((label, index) => (
            <div
              key={label}
              role="listitem"
              aria-current={index === step ? "step" : undefined}
              className={
                "onboarding-step" +
                (index === step ? " active" : "") +
                (index < step ? " done" : "")
              }
            >
              <div className="onboarding-step-dot">{index + 1}</div>
              <span className="onboarding-step-label">{label}</span>
            </div>
          ))}
        </div>

        <div className="onboarding-body">
          {step === 0 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Business basics</h2>
                <p className="onboarding-text">
                  Start with the details that make the forecast feel specific
                  to your business, not a generic template.
                </p>
              </div>

              <div className="onboarding-field-grid">
                <label className="onboarding-field">
                  Business name
                  <span className="field-hint">
                    This appears on your saved operating profile.
                  </span>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Riverside Coffee"
                  />
                </label>

                <label className="onboarding-field">
                  Town or city
                  <span className="field-hint">
                    Optional, but useful when managers review the plan.
                  </span>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>

              <div className="business-type-grid">
                <button
                  type="button"
                  onClick={() => handleBusinessTypeSelect("cafe")}
                  className={
                    "business-type-card" +
                    (businessType === "cafe" ? " selected" : "")
                  }
                >
                  <span className="business-type-eyebrow">Food and drink</span>
                  <span className="business-type-title">Cafe / Restaurant</span>
                  <span className="business-type-sub">
                    Built around orders, covers, service peaks, and floor teams.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleBusinessTypeSelect("gym")}
                  className={
                    "business-type-card" +
                    (businessType === "gym" ? " selected" : "")
                  }
                >
                  <span className="business-type-eyebrow">Fitness</span>
                  <span className="business-type-title">Gym / Fitness</span>
                  <span className="business-type-sub">
                    Built around check-ins, classes, PT sessions, and reception.
                  </span>
                </button>
              </div>

              <div className="onboarding-field-grid">
                <label className="onboarding-field">
                  Business subtype
                  <span className="field-hint">
                    Helps Scheduloop choose better starting roles.
                  </span>
                  <select
                    value={businessSubtype}
                    onChange={(e) => handleBusinessSubtypeChange(e.target.value)}
                  >
                    {subtypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="onboarding-field">
                  Typical customer pattern
                  <span className="field-hint">
                    Shapes the starter forecast before CSV history is added.
                  </span>
                  <select
                    value={customerPattern}
                    onChange={(e) => handleCustomerPatternChange(e.target.value)}
                  >
                    {CUSTOMER_PATTERN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Opening hours</h2>
                <p className="onboarding-text">
                  Set the trading window Scheduloop should forecast. If weekends
                  run differently, add one simple weekend pattern.
                </p>
              </div>

              <div className="onboarding-note-panel hours-help-panel">
                <strong>Why this matters</strong>
                <p>
                  Opening hours decide which parts of the day appear in the
                  staffing plan, including prep and close cover.
                </p>
              </div>

              <div className="hours-row">
                <label className="hours-field">
                  <span className="hours-label">Weekday opens</span>
                  <select
                    className="hours-select"
                    value={openingHours.open}
                    onChange={(e) =>
                      setOpeningHours((prev) => ({
                        ...prev,
                        open: e.target.value,
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

                <label className="hours-field">
                  <span className="hours-label">Weekday closes</span>
                  <select
                    className="hours-select"
                    value={openingHours.close}
                    onChange={(e) =>
                      setOpeningHours((prev) => ({
                        ...prev,
                        close: e.target.value,
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

              <label className="onboarding-check">
                <input
                  type="checkbox"
                  checked={openingHours.weekend.enabled}
                  onChange={(e) =>
                    setOpeningHours((prev) => ({
                      ...prev,
                      weekend: {
                        ...prev.weekend,
                        enabled: e.target.checked,
                      },
                    }))
                  }
                />
                Use different weekend hours
              </label>

              {openingHours.weekend.enabled && (
                <div className="hours-row">
                  <label className="hours-field">
                    <span className="hours-label">Weekend opens</span>
                    <select
                      className="hours-select"
                      value={openingHours.weekend.open}
                      onChange={(e) =>
                        setOpeningHours((prev) => ({
                          ...prev,
                          weekend: {
                            ...prev.weekend,
                            open: e.target.value,
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

                  <label className="hours-field">
                    <span className="hours-label">Weekend closes</span>
                    <select
                      className="hours-select"
                      value={openingHours.weekend.close}
                      onChange={(e) =>
                        setOpeningHours((prev) => ({
                          ...prev,
                          weekend: {
                            ...prev.weekend,
                            close: e.target.value,
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
                <p className="form-error">
                  Closing time must be later than opening time.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Staff roles</h2>
                <p className="onboarding-text">
                  Confirm the teams that affect cover decisions. Remove anything
                  that does not apply and add any role you want included.
                </p>
              </div>

              <div className="onboarding-role-list">
                {roles.map((role) => (
                  <article key={role.id} className="onboarding-role-card">
                    <div className="onboarding-role-main">
                      <span
                        className="role-color-dot"
                        style={{ backgroundColor: role.color }}
                      />
                      <div>
                        <strong>{role.name}</strong>
                        <p>{role.description || "Custom staff role."}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="remove-role-button"
                      onClick={() => handleRemoveRole(role.id)}
                      aria-label={`Remove ${role.name}`}
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>

              <div className="add-role-section">
                <h3 className="add-role-title">Add a role</h3>
                <p className="onboarding-inline-help">
                  Add roles, not employee names. You can schedule people outside
                  Scheduloop later.
                </p>
                <div className="add-role-row">
                  <input
                    type="text"
                    placeholder={
                      businessType === "gym" ? "e.g. Lifeguard" : "e.g. Porter"
                    }
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    className="add-role-input"
                  />
                  <button
                    type="button"
                    className="add-role-button"
                    onClick={handleAddRole}
                  >
                    Add
                  </button>
                </div>

                <div className="color-picker-label">Colour</div>
                <div className="color-picker">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={
                        "color-swatch" +
                        (newRoleColor === color ? " color-swatch-selected" : "")
                      }
                      style={{ backgroundColor: color }}
                      onClick={() => setNewRoleColor(color)}
                      aria-label={`Use ${color} for the new role`}
                      aria-pressed={newRoleColor === color}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Staffing rules</h2>
                <p className="onboarding-text">
                  Set the practical guardrails that turn demand into staff
                  numbers. Rough values are fine for now.
                </p>
              </div>

              <div className="onboarding-note-panel">
                <strong>How to think about this</strong>
                <p>
                  Minimum cover is the fewest people you would safely run with.
                  Peak cover is the most you usually need when the day is at
                  full stretch.
                </p>
              </div>

              <div className="onboarding-staffing-list">
                {roles.map((role) => (
                  <article key={role.id} className="onboarding-staffing-card">
                    <div>
                      <strong>{role.name}</strong>
                      <p>{role.description || "Custom staff role."}</p>
                    </div>

                    <div className="onboarding-staffing-grid">
                      <label className="onboarding-field compact">
                        Minimum cover
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={role.minStaff ?? 0}
                          onChange={(e) =>
                            handleRolePatch(role.id, {
                              minStaff: normalizeStaffCount(e.target.value),
                            })
                          }
                        />
                      </label>

                      <label className="onboarding-field compact">
                        Peak cover
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={peakStaff[role.id] ?? 0}
                          onChange={(e) =>
                            handlePeakStaffChange(role.id, e.target.value)
                          }
                        />
                      </label>

                      <label className="onboarding-field compact">
                        Capacity / hour
                        <span className="field-hint">
                          Roughly what one person can handle.
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={role.serviceRate ?? 0}
                          onChange={(e) =>
                            handleRolePatch(role.id, {
                              serviceRate: normalizePositiveNumber(
                                e.target.value,
                                0
                              ),
                            })
                          }
                        />
                      </label>

                      <label className="onboarding-check inline">
                        <input
                          type="checkbox"
                          checked={!!role.requiredDuringOpen}
                          onChange={(e) =>
                            handleRolePatch(role.id, {
                              requiredDuringOpen: e.target.checked,
                            })
                          }
                        />
                        Required while open
                      </label>
                    </div>
                  </article>
                ))}
              </div>

              <p className="onboarding-text small">
                Capacity means roughly how many orders, visits, bookings, or
                customers one person in this role can handle in an hour.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Starting forecast setup</h2>
                <p className="onboarding-text">
                  Choose the broad demand pattern behind the first plan.
                  Historical CSV data can improve confidence later.
                </p>
              </div>

              <div className="onboarding-choice-section">
                <h3 className="add-role-title">When are you usually busiest?</h3>
                <p className="onboarding-inline-help">
                  This gently shapes the starter forecast before real trading
                  data is uploaded.
                </p>
                <div className="busy-level-grid rhythm-grid">
                  {BUSINESS_RHYTHM_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setBusinessRhythm(option.value)}
                      className={
                        "busy-level-card" +
                        (businessRhythm === option.value ? " selected" : "")
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="onboarding-choice-section">
                <h3 className="add-role-title">Typical day level</h3>
                <p className="onboarding-inline-help">
                  Pick the level that feels closest to an average trading day.
                </p>
                <div className="busy-level-grid">
                  {[
                    { value: "quiet", label: "Quiet" },
                    { value: "normal", label: "Normal" },
                    { value: "busy", label: "Busy" },
                    { value: "veryBusy", label: "Very busy" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setBusyLevel(opt.value)}
                      className={
                        "busy-level-card" +
                        (busyLevel === opt.value ? " selected" : "")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="onboarding-demand-card">
                <div>
                  <h3>Optional demand estimates</h3>
                  <p>
                    Rough daily numbers are enough. Leave this blank if you are
                    not sure yet.
                  </p>
                </div>

                <label className="onboarding-field">
                  Estimate type
                  <select
                    value={safeDemandEstimates.unit}
                    onChange={(e) =>
                      handleDemandEstimateChange("unit", e.target.value)
                    }
                  >
                    {demandUnitOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="onboarding-field-grid three">
                  {[
                    { key: "quiet", label: "Quiet day" },
                    { key: "normal", label: "Normal day" },
                    { key: "busy", label: "Busy day" },
                  ].map((item) => (
                    <label key={item.key} className="onboarding-field compact">
                      {item.label}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={demandEstimates[item.key] ?? ""}
                        placeholder={demandUnitLabel}
                        onChange={(e) =>
                          handleDemandEstimateChange(item.key, e.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="onboarding-section">
              <div className="onboarding-section-header">
                <h2 className="onboarding-title">Review profile</h2>
                <p className="onboarding-text">
                  Here is the operating profile Scheduloop will use to shape
                  your first staffing plan.
                </p>
              </div>

              <div className="onboarding-review-hero">
                <span>Ready for the first plan</span>
                <strong>{businessName || "My business"}</strong>
                <p>
                  The forecast will start from your setup and operating
                  patterns. Uploading historical data later will improve
                  confidence.
                </p>
                <div className="onboarding-review-metrics">
                  <div>
                    <span>Roles</span>
                    <strong>{roles.length}</strong>
                  </div>
                  <div>
                    <span>Peak cover</span>
                    <strong>{totalPeakStaff}</strong>
                  </div>
                  <div>
                    <span>CSV history</span>
                    <strong>Not yet</strong>
                  </div>
                </div>
              </div>

              <div className="onboarding-review-grid">
                <section className="onboarding-review-card">
                  <button type="button" onClick={() => setStep(0)}>
                    Edit
                  </button>
                  <span>Business</span>
                  <strong>{businessName || "My business"}</strong>
                  <p>
                    {getBusinessTypeLabel(businessType)} /{" "}
                    {getSelectedLabel(subtypeOptions, businessSubtype)}
                    {location ? ` in ${location}` : ""}
                  </p>
                  <p>
                    Pattern:{" "}
                    {getSelectedLabel(CUSTOMER_PATTERN_OPTIONS, customerPattern)}
                  </p>
                </section>

                <section className="onboarding-review-card">
                  <button type="button" onClick={() => setStep(1)}>
                    Edit
                  </button>
                  <span>Opening hours</span>
                  <strong>
                    {openingHours.open} - {openingHours.close}
                  </strong>
                  <p>
                    {openingHours.weekend.enabled
                      ? `Weekend: ${openingHours.weekend.open} - ${openingHours.weekend.close}`
                      : "Weekend hours use the same times."}
                  </p>
                </section>

                <section className="onboarding-review-card">
                  <button type="button" onClick={() => setStep(2)}>
                    Edit
                  </button>
                  <span>Roles</span>
                  <strong>{roles.length} roles</strong>
                  <p>{roles.map((role) => role.name).join(", ")}</p>
                </section>

                <section className="onboarding-review-card">
                  <button type="button" onClick={() => setStep(3)}>
                    Edit
                  </button>
                  <span>Staffing</span>
                  <strong>Peak total {totalPeakStaff}</strong>
                  <p>
                    Minimum cover and required-while-open settings are saved per
                    role.
                  </p>
                </section>

                <section className="onboarding-review-card">
                  <button type="button" onClick={() => setStep(4)}>
                    Edit
                  </button>
                  <span>Forecast start</span>
                  <strong>
                    {getSelectedLabel(BUSINESS_RHYTHM_OPTIONS, businessRhythm)}
                  </strong>
                  <p>
                    No CSV history yet. Confidence starts from the saved
                    business profile and improves when trading data is added.
                  </p>
                </section>
              </div>
            </div>
          )}
        </div>

        {saveError && (
          <p className="form-error onboarding-save-error" role="alert">
            {saveError}
          </p>
        )}

        <div className="onboarding-footer">
          <p className="onboarding-footer-note">
            These settings can be edited later from Setup View.
          </p>
          <div className="onboarding-footer-actions">
            <button
              type="button"
              className="onboarding-nav-button secondary"
              onClick={goBack}
              disabled={step === 0 || isSaving}
            >
              Back
            </button>
            <button
              type="button"
              className="onboarding-nav-button primary"
              onClick={goNext}
              disabled={!canGoNext || isSaving}
            >
              {step === STEP_LABELS.length - 1
                ? isSaving
                  ? "Saving..."
                  : "Create first forecast"
                : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OnboardingPage;
