import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  getFriendlyAuthErrorMessage,
  isValidEmail,
} from "../utils/authErrors";

const RESEND_COOLDOWN_MS = 60 * 1000;

function getCooldownRemaining(lastSentAt) {
  if (!lastSentAt) return 0;
  const remaining = RESEND_COOLDOWN_MS - (Date.now() - lastSentAt);
  return Math.max(0, Math.ceil(remaining / 1000));
}

function LoginPage() {
  const {
    user,
    requestSignInLink,
    completeEmailLinkSignIn,
    getEmailForSignIn,
    isEmailSignInLink,
  } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => getEmailForSignIn());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const currentUrl = typeof window === "undefined" ? "" : window.location.href;
  const completingLink = useMemo(
    () => (currentUrl ? isEmailSignInLink(currentUrl) : false),
    [currentUrl, isEmailSignInLink]
  );

  useEffect(() => {
    if (!lastSentAt) return undefined;
    const update = () => setCooldownSeconds(getCooldownRemaining(lastSentAt));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [lastSentAt]);

  useEffect(() => {
    let active = true;

    async function completeStoredEmailLink() {
      if (!completingLink || !email) return;

      setError("");
      setMessage("Checking your secure sign-in link...");
      setIsSubmitting(true);

      try {
        await completeEmailLinkSignIn(email, currentUrl);
        if (active) navigate("/", { replace: true });
      } catch (err) {
        if (active) {
          setMessage("");
          setError(
            getFriendlyAuthErrorMessage(
              err,
              "We could not complete sign-in. Request a new secure link."
            )
          );
        }
      } finally {
        if (active) setIsSubmitting(false);
      }
    }

    completeStoredEmailLink();

    return () => {
      active = false;
    };
  }, [completeEmailLinkSignIn, completingLink, currentUrl, email, navigate]);

  if (user && !completingLink) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setError("Enter a valid work email address.");
      return;
    }

    if (completingLink) {
      setIsSubmitting(true);
      try {
        await completeEmailLinkSignIn(normalizedEmail, currentUrl);
        navigate("/", { replace: true });
      } catch (err) {
        setError(
          getFriendlyAuthErrorMessage(
            err,
            "We could not complete sign-in. Request a new secure link."
          )
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (cooldownSeconds > 0) return;

    setIsSubmitting(true);
    try {
      await requestSignInLink(normalizedEmail);
      setEmail(normalizedEmail);
      setLastSentAt(Date.now());
      setMessage(
        "If this email is authorised for ScheduleLoop, we have sent a secure sign-in link."
      );
    } catch (err) {
      setError(
        getFriendlyAuthErrorMessage(
          err,
          "We could not send a sign-in link. Please try again."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const buttonLabel = completingLink
    ? isSubmitting
      ? "Checking link..."
      : "Finish sign-in"
    : isSubmitting
      ? "Sending link..."
      : cooldownSeconds > 0
        ? `Send another link in ${cooldownSeconds}s`
        : "Send secure sign-in link";

  return (
    <div className="app auth-screen">
      <div className="auth-card">
        <h1>Sign in to ScheduleLoop</h1>
        <p className="subtitle">
          {completingLink
            ? "Enter the same work email used to request this link."
            : "Enter your authorised work email and we will send a secure sign-in link."}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            Work email
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-success">{message}</p>}

          <button
            type="submit"
            className="auth-button"
            disabled={isSubmitting || cooldownSeconds > 0}
          >
            {buttonLabel}
          </button>
        </form>

        {completingLink && error && (
          <p className="auth-switch">
            <Link to="/login" replace>Request a new secure link</Link>
          </p>
        )}

        <p className="auth-switch auth-legal-links">
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true">/</span>
          <Link to="/terms">Terms</Link>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
