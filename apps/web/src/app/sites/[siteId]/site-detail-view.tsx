import type { OwnerDeclarationScope, WorkspaceCrawlRun } from "@website-bot-scroll/db/site-workspace";

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

function CrawlSummary({ run }: { run: WorkspaceCrawlRun }) {
  const { coverage, startedAt, finishedAt, pages, errors } = run;
  const seconds = startedAt && finishedAt ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  const duration = seconds === null ? null : seconds < 1 ? "Under 1 second" : seconds < 60 ? `${seconds} seconds` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <>
    <div className="run-heading">
      <h3>{runLabels[run.status]}</h3>
      {duration ? <span>{duration}</span> : null}
    </div>
    {run.stopReason && Object.hasOwn(stopMessages, run.stopReason) ? <p>{stopMessages[run.stopReason]}</p> : null}
    {run.status === "PENDING" ? <p>Waiting for a crawl worker.</p> : null}
    <div className="coverage-grid">
      <span>{coverage.collected} collected</span>
      <span>{coverage.failed} failed</span>
      <span>{coverage.discovered} discovered</span>
      <span>{coverage.unattempted ?? Math.max(0, coverage.discovered - coverage.attempted)} not attempted</span>
    </div>
    {pages?.length ? <details className="crawl-result-details">
      <summary>View collected pages ({pages.length})</summary>
      <ol className="crawl-page-list">{pages.map(({ url, statusCode }, index) => <li key={index}>
        <span>{url}</span>{statusCode !== null ? <span>HTTP {statusCode}</span> : null}
      </li>)}</ol>
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
    {activeRun ? <meta httpEquiv="refresh" content="5" /> : null}
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
        {authorization ? activeRun ? <p className="notice notice-error">A crawl is already active. This page refreshes every five seconds.</p> : <form className="site-form crawl-form" method="post" action={`/api/sites/${site.id}/crawl`}><label>Maximum pages<input name="maxPages" type="number" min="1" max="100" step="1" defaultValue="25" required /></label><label>Maximum depth<input name="maxDepth" type="number" min="0" max="3" step="1" defaultValue="1" required /></label><label>Maximum duration (seconds)<input name="maxDurationSeconds" type="number" min="10" max="300" step="1" defaultValue="60" required /></label><p className="field-help">Each response is limited to 5 MiB. The registered host is the only allowed scope.</p><button className="button button-primary form-submit" type="submit">Start bounded crawl</button></form> : null}
      </section>
    </div>
  </main>;
}
