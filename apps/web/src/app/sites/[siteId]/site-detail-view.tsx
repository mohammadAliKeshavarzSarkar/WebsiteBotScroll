import type { OwnerDeclarationScope, WorkspaceCrawlRun } from "@website-bot-scroll/db/site-workspace";

type SiteSummary = { id: string; name: string; origin: string };
type AuthorizationSummary = { id: string; description: string; scope: OwnerDeclarationScope; createdAt: Date };
type Feedback = { authorized?: boolean; error?: string };

export function SiteDetailView({ site, authorization, latestRun, feedback = {} }: { site: SiteSummary; authorization: AuthorizationSummary | null; latestRun: WorkspaceCrawlRun | null; feedback?: Feedback }) {
  return <main className="workspace-shell detail-shell">
    <header className="workspace-header"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a><a className="text-link" href="/sites">← All websites</a></header>
    <section className="detail-hero"><div><p className="eyebrow">Registered website</p><h1>{site.name}</h1><p className="detail-origin">{site.origin}</p></div><span className={`status-chip ${authorization ? "status-ready" : ""}`}>{authorization ? "Authorized" : "Authorization required"}</span></section>
    {feedback.authorized ? <div className="notice notice-success" role="status"><strong>Authorization recorded.</strong> You can now configure a bounded manual crawl.</div> : null}
    {feedback.error ? <div className="notice notice-error" role="alert"><strong>Authorization not recorded.</strong> {feedback.error}</div> : null}
    <div className="detail-grid">
      <section className="detail-panel"><p className="panel-kicker">Step 2 of 3</p><h2>Owner declaration</h2>
        {authorization ? <><h3>Authorized for bounded collection</h3><p>This owner declaration is recorded permission, not technical domain verification.</p><dl className="scope-list"><div><dt>Seed URL</dt><dd>{authorization.scope.seed_urls.join(", ")}</dd></div><div><dt>Allowed host</dt><dd>{authorization.scope.allowed_hosts.join(", ")}</dd></div></dl></> : <><p>Confirm that you own this website or have permission to crawl it. This is an owner declaration, not technical domain verification.</p><form className="site-form" method="post" action={`/api/sites/${site.id}/authorize`}><label className="check-row"><input name="declaration" type="checkbox" required /> I own this website or have permission to crawl it.</label><button className="button button-primary form-submit" type="submit">Record authorization</button></form></>}
      </section>
      <section className="detail-panel"><p className="panel-kicker">Persisted status</p><h2>Latest crawl</h2>
        {!latestRun ? <p className="muted-copy">No crawl has been requested. Authorization alone does not collect any pages.</p> : <><div className="run-heading"><strong>{latestRun.status}</strong><span>{latestRun.stopReason ?? "In progress"}</span></div><div className="coverage-grid"><span>{latestRun.coverage.discovered} discovered</span><span>{latestRun.coverage.attempted} attempted</span><span>{latestRun.coverage.collected} collected</span><span>{latestRun.coverage.failed} failed</span></div>{latestRun.errors.length ? <ul className="error-list">{latestRun.errors.map((error, index) => <li key={`${error.code}-${index}`}><strong>{error.code}</strong> {error.message}</li>)}</ul> : null}</>}
      </section>
    </div>
  </main>;
}
