export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-story"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a><div><p className="eyebrow">Protected owner access</p><h1>Return to your evidence workspace.</h1><p>Manage authorized sites, collection boundaries, and preserved crawl evidence from one tenant-isolated workspace.</p></div><div className="login-proof"><span>Read-only collection</span><span>Exact provenance</span><span>Immutable snapshots</span></div></section>
      <section className="login-panel">
        <div className="login-card"><p className="panel-kicker">Owner account</p><h2>Sign in</h2><p>Use the bootstrap owner credentials configured for this installation.</p><form className="site-form" method="post" action="/api/auth/login"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /><button className="button button-primary form-submit" type="submit">Open workspace</button></form><a className="back-link" href="/">Back to product overview</a></div>
      </section>
    </main>
  );
}
