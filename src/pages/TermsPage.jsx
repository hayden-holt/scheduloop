import { Link } from "react-router-dom";

function TermsPage() {
  return (
    <main className="app legal-page">
      <article className="legal-card">
        <p className="section-kicker">Terms draft</p>
        <h1>ScheduleLoop Application Terms</h1>
        <p className="legal-updated">DRAFT - LEGAL REVIEW REQUIRED</p>
        <p>
          These draft terms describe the expected rules for business users of
          ScheduleLoop. Hayden must complete the TODO placeholders and obtain
          legal review before relying on them in production.
        </p>

        <section>
          <h2>Service</h2>
          <p>
            ScheduleLoop provides demand-led staffing guidance, role planning,
            CSV-based forecasting support and rota planning tools for authorised
            business users.
          </p>
        </section>

        <section>
          <h2>Eligibility and account responsibility</h2>
          <p>
            Access is provided only to manually approved businesses and their
            authorised managers. Users must use their own work email, keep access
            links secure and tell ScheduleLoop if a manager should be removed.
          </p>
        </section>

        <section>
          <h2>Customer data</h2>
          <p>
            The customer business is responsible for making sure it has the
            right to upload employee, rota, staffing and historical demand data.
            ScheduleLoop uses that data to provide the application and support
            the workspace.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>
            Users must not attempt to access another workspace, bypass security,
            overload Firebase services, upload malicious files, misuse exports
            or use ScheduleLoop for unlawful purposes.
          </p>
        </section>

        <section>
          <h2>Availability and changes</h2>
          <p>
            ScheduleLoop is an MVP and may change as the product develops.
            Forecasts and labour-cost estimates are planning guidance, not
            payroll, HR, legal or financial advice.
          </p>
        </section>

        <section>
          <h2>Suspension, deletion and liability</h2>
          <p>
            TODO: add the final suspension, termination, liability, warranty,
            governing law, dispute and contact clauses. Do not launch without
            legal review.
          </p>
        </section>

        <section>
          <h2>Privacy</h2>
          <p>
            The privacy notice explains how ScheduleLoop handles account,
            workspace, workforce and technical data.
          </p>
        </section>

        <nav className="legal-nav" aria-label="Legal navigation">
          <Link to="/login">Sign in</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </article>
    </main>
  );
}

export default TermsPage;
