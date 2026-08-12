import { Link } from "react-router-dom";

function PrivacyPage() {
  return (
    <main className="app legal-page">
      <article className="legal-card">
        <p className="section-kicker">Privacy notice draft</p>
        <h1>ScheduleLoop Privacy Notice</h1>
        <p className="legal-updated">Last updated: TODO before production</p>
        <p>
          This draft explains how the ScheduleLoop application handles account,
          business, workforce, rota, forecast and CSV data. It must be reviewed
          and completed by Hayden and legal support before production use.
        </p>

        <section>
          <h2>Who is responsible</h2>
          <p>
            TODO: add the legal name, trading name, registered address, company
            number if applicable, privacy contact email and ICO registration
            status before launch.
          </p>
        </section>

        <section>
          <h2>Information the app collects</h2>
          <ul>
            <li>Manager account email and Firebase authentication metadata.</li>
            <li>Workspace membership and role information created during manual onboarding.</li>
            <li>Business profile details such as name, location, business type, opening hours and operating assumptions.</li>
            <li>Role, staffing, labour-cost, rota, employee name, shift and feedback data entered by managers.</li>
            <li>CSV demand or trading-history data uploaded by the customer business.</li>
            <li>Technical and security data needed to run Firebase, Firestore and App Check.</li>
          </ul>
        </section>

        <section>
          <h2>How information is used</h2>
          <p>
            ScheduleLoop uses this information to authenticate authorised users,
            protect each workspace, generate staffing guidance, support rota
            planning, save settings, process CSV uploads and respond to support,
            correction, access or deletion requests.
          </p>
          <p>
            TODO: confirm final lawful bases, customer controller/processor
            position, retention periods and support contact process.
          </p>
        </section>

        <section>
          <h2>Processors and storage</h2>
          <p>
            The repository uses Firebase Authentication, Cloud Firestore and
            Firebase App Check. TODO: confirm the Firebase/Google Cloud region,
            any other production processors, international-transfer position and
            subprocessors before launch.
          </p>
        </section>

        <section>
          <h2>Retention, deletion and rights</h2>
          <p>
            Customers can request access, correction, export, manager removal,
            employee record removal or workspace deletion through the support
            contact. TODO: add the final contact details, response process,
            deletion workflow and complaints details, including ICO wording if
            applicable.
          </p>
        </section>

        <section>
          <h2>Security</h2>
          <p>
            ScheduleLoop uses Firebase Authentication, Firestore Security Rules,
            workspace membership checks, App Check support and data validation to
            reduce unauthorised access risks. No security measure is perfect, so
            suspected incidents should be reviewed using the incident response
            documentation.
          </p>
        </section>

        <nav className="legal-nav" aria-label="Legal navigation">
          <Link to="/login">Sign in</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </article>
    </main>
  );
}

export default PrivacyPage;
