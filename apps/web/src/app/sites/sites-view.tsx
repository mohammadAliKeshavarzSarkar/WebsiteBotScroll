export type WorkspaceSite = { id: string; name: string; origin: string };
export type WorkspaceFeedback = { created?: boolean; error?: string; name?: string; origin?: string };

export function SitesView({ sites, feedback = {} }: { sites: WorkspaceSite[]; feedback?: WorkspaceFeedback }) {
  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a>
        <div className="workspace-identity"><span className="workspace-dot" /> Owner workspace</div>
      </header>

      <section className="workspace-intro">
        <div><p className="eyebrow">Website registry</p><h1>Your monitored websites.</h1><p>Register a domain you control. We will keep authorization, collection boundaries, and evidence status visible at every step.</p></div>
        <div className="workspace-count"><strong>{sites.length}</strong><span>{sites.length === 1 ? "website" : "websites"}</span></div>
      </section>

      {feedback.created ? <div className="notice notice-success" role="status"><strong>Website registered.</strong> It is ready for authorization setup.</div> : null}
      {feedback.error ? <div className="notice notice-error" role="alert"><strong>Check the website details.</strong> {feedback.error}</div> : null}

      <div className="workspace-grid">
        <section className="onboarding-panel" aria-labelledby="add-site-title">
          <p className="panel-kicker">Step 1 of 3</p>
          <h2 id="add-site-title">{sites.length ? "Add another website" : "Add your first website"}</h2>
          <p>Use a clear label and paste any page from the website. We safely reduce it to its HTTP(S) origin.</p>
          <form className="site-form" method="post" action="/api/sites">
            <label htmlFor="site-name">Website name</label>
            <input id="site-name" name="name" type="text" maxLength={80} defaultValue={feedback.name ?? ""} placeholder="Main website" autoComplete="organization" required />
            <label htmlFor="site-origin">Website URL</label>
            <input id="site-origin" name="origin" type="url" defaultValue={feedback.origin ?? ""} placeholder="https://example.com" autoComplete="url" required aria-describedby="origin-help" />
            <p className="field-help" id="origin-help">Include <code>https://</code>. Paths and query details are removed before saving.</p>
            <button className="button button-primary form-submit" type="submit">Register website</button>
          </form>
          <div className="next-step"><span>Next</span><p><strong>Authorization and crawl controls come next.</strong> Registration does not start a crawl or modify the website.</p></div>
        </section>

        <section className="sites-panel" aria-labelledby="registered-sites-title">
          <div className="panel-heading"><div><p className="panel-kicker">Your scope</p><h2 id="registered-sites-title">Registered websites</h2></div><span className="readonly-tag">Read-only</span></div>
          {sites.length === 0 ? (
            <div className="empty-sites"><span className="empty-glyph" aria-hidden="true">⌁</span><h3>No websites registered yet</h3><p>Your first website will appear here with its authorization and evidence state.</p></div>
          ) : (
            <ul className="site-list">
              {sites.map((site) => <li key={site.id} className="site-row"><span className="site-monogram" aria-hidden="true">{site.name.slice(0, 1).toUpperCase()}</span><div className="site-main"><strong>{site.name}</strong><span>{site.origin}</span></div><div className="site-state"><span className="state-dot" />Ready for authorization</div></li>)}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
