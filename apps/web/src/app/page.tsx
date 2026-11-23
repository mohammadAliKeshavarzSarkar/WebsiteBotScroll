export default function HomePage() {
  return (
    <main className="landing-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="WebsiteBotScroll home"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a>
        <div className="nav-actions"><a className="text-link" href="#workflow">How it works</a><a className="button button-small button-ghost" href="/sites">Owner sign in</a></div>
      </nav>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-pulse" /> Read-only by design</p>
          <h1>SEO monitoring<br />you can <em>prove.</em></h1>
          <p className="hero-lede">WebsiteBotScroll collects technical evidence from authorized websites, preserves exactly what was observed, and gives your team a trustworthy record to review.</p>
          <div className="hero-actions"><a className="button button-primary" href="/sites">Open your workspace</a><a className="button button-quiet" href="#workflow">See the evidence flow</a></div>
          <p className="hero-note">No rankings are manipulated. No content is rewritten. No observation is invented.</p>
        </div>
        <div className="evidence-window" aria-label="Illustration of an evidence collection run">
          <div className="window-bar"><span className="window-title">live evidence · example.com</span><span className="window-state">COLLECTING</span></div>
          <div className="window-body">
            <div className="run-summary"><div><span className="metric-value">24</span><span className="metric-label">pages found</span></div><div><span className="metric-value">18</span><span className="metric-label">observed</span></div><div><span className="metric-value">6</span><span className="metric-label">remaining</span></div></div>
            <div className="evidence-log"><p><span className="log-time">09:41:02</span><span className="log-ok">200</span><span>/</span></p><p><span className="log-time">09:41:03</span><span className="log-ok">200</span><span>/products</span></p><p><span className="log-time">09:41:04</span><span className="log-warn">301</span><span>/old-page</span></p><p className="log-active"><span className="log-time">09:41:05</span><span className="log-dot">●</span><span>/about</span></p></div>
            <div className="evidence-footer"><span>scope locked</span><span>headers preserved</span><span>sha-256</span></div>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Product principles"><span>Authorized scope</span><span>Exact observations</span><span>Immutable snapshots</span><span>Verifiable exports</span></section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading"><p className="eyebrow">A traceable workflow</p><h2>From a domain to defensible evidence.</h2><p>Every stage keeps collection facts separate from interpretation, so your team can see what was observed and where coverage stopped.</p></div>
        <div className="workflow-grid">
          <article className="workflow-card"><span className="step-label">01 · AUTHORIZE</span><h3>Define the boundary</h3><p>Add a website and explicitly control its permitted hosts, seed pages, and collection limits.</p><span className="card-detail">Nothing outside scope is collected</span></article>
          <article className="workflow-card featured"><span className="step-label">02 · OBSERVE</span><h3>Collect read-only evidence</h3><p>Capture HTTP transactions, metadata, content signals, links, and known limitations without modifying the target.</p><span className="card-detail">Ordered, attributed, preserved</span></article>
          <article className="workflow-card"><span className="step-label">03 · VERIFY</span><h3>Freeze a trusted record</h3><p>Produce an immutable snapshot and exact-byte export that independent systems can verify.</p><span className="card-detail">Checksummed and replayable</span></article>
        </div>
      </section>

      <section className="boundary-section">
        <div><p className="eyebrow">Evidence before advice</p><h2>Know what the crawler knows—and what it does not.</h2></div>
        <div className="boundary-list"><div><span className="boundary-icon">+</span><p><strong>Preserved provenance</strong>Every observation keeps its collector, timestamp, source, and version.</p></div><div><span className="boundary-icon">+</span><p><strong>Visible limitations</strong>Unavailable pages and partial coverage stay explicit instead of being filled in.</p></div><div><span className="boundary-icon">+</span><p><strong>Independent verification</strong>Exports retain stable identities and exact checksums for downstream review.</p></div></div>
      </section>

      <section className="final-cta"><p className="eyebrow">Your first verified site</p><h2>Start with the domain you own.</h2><p>Sign in to register a website. Authorization and crawl controls are the next step inside your workspace.</p><a className="button button-primary" href="/sites">Open your workspace</a></section>
      <footer className="site-footer"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a><p>Evidence-based SEO monitoring.</p><a className="text-link" href="/login">Owner access</a></footer>
    </main>
  );
}
