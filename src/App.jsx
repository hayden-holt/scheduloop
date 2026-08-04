// src/App.jsx
import "./App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/AuthContext";
import { BusinessProfileProvider } from "./business/BusinessProfileProvider";
import { useBusinessProfile } from "./business/BusinessProfileContext";
import { ThemeProvider } from "./theme/ThemeProvider";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RotaPage = lazy(() => import("./pages/RotaPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AppShell = lazy(() => import("./components/AppShell"));

function RouteError({ message }) {
  return (
    <div className="app route-error-screen">
      <div className="route-error-card">
        <h1>We could not load your profile</h1>
        <p>{message}</p>
        <button
          type="button"
          className="route-error-button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function RouteFallback({ message = "Loading Scheduloop..." }) {
  return (
    <div className="app route-loading-screen" aria-label="Loading">
      <div className="route-loading-spinner" />
      <p className="route-loading-text">{message}</p>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function ProfileReadyRoute({ children }) {
  const { loadingProfile, profileError } = useBusinessProfile();
  if (loadingProfile) {
    return <RouteFallback message="Loading your business profile..." />;
  }
  if (profileError) return <RouteError message={profileError} />;
  return children;
}

function CompleteProfileRoute({ children }) {
  const { hasProfile } = useBusinessProfile();
  if (!hasProfile) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <ProfileReadyRoute>
                <OnboardingPage />
              </ProfileReadyRoute>
            </ProtectedRoute>
          }
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ProfileReadyRoute>
                <CompleteProfileRoute>
                  <AppShell>
                    <DashboardPage />
                  </AppShell>
                </CompleteProfileRoute>
              </ProfileReadyRoute>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rota"
          element={
            <ProtectedRoute>
              <ProfileReadyRoute>
                <CompleteProfileRoute>
                  <AppShell>
                    <RotaPage />
                  </AppShell>
                </CompleteProfileRoute>
              </ProfileReadyRoute>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <ProfileReadyRoute>
                <CompleteProfileRoute>
                  <AppShell>
                    <SettingsPage />
                  </AppShell>
                </CompleteProfileRoute>
              </ProfileReadyRoute>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BusinessProfileProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </BusinessProfileProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
