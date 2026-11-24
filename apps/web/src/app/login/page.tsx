export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-story"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">W</span><span>WebsiteBotScroll</span></a><div><p className="eyebrow">Protected owner access</p><h1>Return to your website workspace.</h1><p>Register tenant-owned websites and prepare each one for the upcoming authorization step.</p></div><div className="login-proof"><span>Tenant scoped</span><span>Normalized origins</span><span>Authorization pending</span></div></section>
      <section className="login-panel">
        <div className="login-card"><p className="panel-kicker">Owner account</p><h2>Sign in</h2><p>Use the bootstrap owner credentials configured for this installation.</p><form className="site-form" method="post" action="/api/auth/login"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /><button className="button button-primary form-submit" type="submit">Open workspace</button></form><a className="back-link" href="/">Back to product overview</a></div>
      </section>
    </main>
  );
}
