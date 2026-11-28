import type { OwnerDeclarationScope, WorkspaceCrawlRun } from "@website-bot-scroll/db/site-workspace";
import { CrawlRefresh } from "./crawl-refresh";

type SiteSummary = { id: string; name: string; origin: string };
type AuthorizationSummary = { id: string; description: string; scope: OwnerDeclarationScope; createdAt: Date };
type Feedback = { authorized?: boolean; error?: string };

const runLabels: Record<WorkspaceCrawlRun["status"], string> = {
  PENDING: "Queued", RUNNING: "Crawling", COMPLETED: "Crawl complete",
  PARTIAL: "Crawl finished with limitations", FAILED: "Crawl failed", CANCELLED: "Crawl cancelled",
};

const stopMessages: Record<string, string> = {
  frontier_exhausted: "Finished checking the pages found within this crawl’s scope.",
  page_limit_reached: "Stopped at the configured page limit.",
  duration_limit_reached: "Stopped at the configured time limit.",
  robots_disallowed: "Some pages were skipped because of robots.txt rules.",
  frontier_checkpoint_missing: "Some URLs from the interrupted crawl could not be recovered.",
  worker_error: "The worker could not finish this crawl.",
};

const completionDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function CrawlSummary({ run }: { run: WorkspaceCrawlRun }) {
  const { coverage, startedAt, finishedAt, pages, errors } = run;
  const seconds = startedAt && finishedAt ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  const duration = seconds === null ? null : seconds < 1 ? "Under 1 second" : seconds === 1 ? "1 second" : seconds < 60 ? `${seconds} seconds` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const notAttempted = coverage.unattempted ?? Math.max(0, coverage.discovered - coverage.attempted);
  const reason = run.stopReason && Object.hasOwn(stopMessages, run.stopReason) ? stopMessages[run.stopReason] : null;
  const metrics = [
    { label: "Pages collected", value: coverage.collected },
    { label: "Pages failed", value: coverage.failed },
    { label: "Pages discovered", value: coverage.discovered },
    { label: "Not attempted", value: notAttempted },
  ];
  return <>
    <div className="crawl-outcome" data-outcome={run.status.toLowerCase()} role="status">
      <h3><span className="crawl-outcome-dot" aria-hidden="true" />{runLabels[run.status]}</h3>
      {reason || run.status === "PENDING" ? <p>{reason ?? "Waiting for a crawl worker."}</p> : null}
      {finishedAt ? <div className="crawl-run-meta">
        <time dateTime={finishedAt.toISOString()}>{completionDate.format(finishedAt)} UTC</time>
        {duration ? <span>{duration}</span> : null}
      </div> : null}
    </div>
    {coverage.discovered > 0 ? <div className="crawl-coverage">
      <div><strong>Collection coverage</strong><span>{coverage.collected} of {coverage.discovered} pages collected</span></div>
      <meter min={0} max={coverage.discovered} value={coverage.collected} aria-label="Collection coverage" />
    </div> : null}
    <dl className="coverage-grid">
      {metrics.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {pages?.length ? <details className="crawl-result-details">
      <summary>View collected pages ({pages.length})</summary>
      <div className="crawl-page-scroll" tabIndex={0} role="region" aria-label="Collected page results">
        <table className="crawl-page-table">
          <thead><tr><th scope="col">Final URL</th><th scope="col">Response</th></tr></thead>
          <tbody>{pages.map(({ url, statusCode }, index) => <tr key={index}>
            <td>{url}</td><td>{statusCode !== null ? <span className="crawl-http-badge" data-success={statusCode >= 200 && statusCode < 300}>HTTP {statusCode}</span> : "Unavailable"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details> : null}
    {errors.length ? <details className="crawl-result-details" open>
      <summary>Collection errors ({errors.length})</summary>
      <ul className="error-list">{errors.map((error, index) => <li key={index}>
        {error.message}{error.url ? <> <span>{error.url}</span></> : null}
      </li>)}</ul>
    </details> : null}
  </>;
}

export function SiteDetailView({ site, authorization, latestRun, feedback = {} }: { site: SiteSummary; authorization: AuthorizationSummary | null; latestRun: WorkspaceCrawlRun | null; feedback?: Feedback }) {
  const activeRun = latestRun?.status === "PENDING" || latestRun?.status === "RUNNING";
  return <main className="workspace-shell detail-shell">
    {activeRun ? <CrawlRefresh /> : null}
    <header className="workspace-header"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a><a className="text-link" href="/sites">← All websites</a></header>
    <section className="detail-hero"><div><p className="eyebrow">Registered website</p><h1>{site.name}</h1><p className="detail-origin">{site.origin}</p></div><span className={`status-chip ${authorization ? "status-ready" : ""}`}>{authorization ? "Authorized" : "Authorization required"}</span></section>
    {feedback.authorized ? <div className="notice notice-success" role="status"><strong>Authorization recorded.</strong> You can now configure a bounded manual crawl.</div> : null}
    {feedback.error ? <div className="notice notice-error" role="alert">{feedback.error}</div> : null}
    <div className="detail-grid">
      <section className="detail-panel"><p className="panel-kicker">Step 2 of 3</p><h2>Owner declaration</h2>
        {authorization ? <><h3>Authorized for bounded collection</h3><p>This owner declaration is recorded permission, not technical domain verification.</p><dl className="scope-list"><div><dt>Seed URL</dt><dd>{authorization.scope.seed_urls.join(", ")}</dd></div><div><dt>Allowed host</dt><dd>{authorization.scope.allowed_hosts.join(", ")}</dd></div></dl></> : <><p>Confirm that you own this website or have permission to crawl it. This is an owner declaration, not technical domain verification.</p><form className="site-form" method="post" action={`/api/sites/${site.id}/authorize`}><label className="check-row"><input name="declaration" type="checkbox" required /> I own this website or have permission to crawl it.</label><button className="button button-primary form-submit" type="submit">Record authorization</button></form></>}
      </section>
      <section className="detail-panel"><h2>Latest crawl</h2>
        <div data-active-run={activeRun ? "true" : "false"}>{!latestRun ? <p className="muted-copy">No crawl has been run yet.</p> : <CrawlSummary run={latestRun} />}</div>
        {authorization ? activeRun ? <p className="muted-copy">The summary updates automatically while this tab is visible.</p> : <details className="crawl-result-details" open={!latestRun}><summary>{latestRun ? "Configure another crawl" : "Configure your first crawl"}</summary><form className="site-form crawl-form" method="post" action={`/api/sites/${site.id}/crawl`}><label>Maximum pages<input name="maxPages" type="number" min="1" max="100" step="1" defaultValue="25" required /></label><label>Maximum depth<input name="maxDepth" type="number" min="0" max="3" step="1" defaultValue="1" required /></label><label>Maximum duration (seconds)<input name="maxDurationSeconds" type="number" min="10" max="300" step="1" defaultValue="60" required /></label><p className="field-help">Each response is limited to 5 MiB. The registered host is the only allowed scope.</p><button className="button button-primary form-submit" type="submit">Start crawl</button></form></details> : null}
      </section>
    </div>
  </main>;
}
