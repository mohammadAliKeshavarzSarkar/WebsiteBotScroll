export default function LoginPage() {
  return (
    <main>
      <p className="eyebrow">WebsiteBotScroll</p>
      <h1>Owner sign in</h1>
      <form method="post" action="/api/auth/login">
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
