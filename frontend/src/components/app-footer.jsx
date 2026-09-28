export function AppFooter({ className = '' }) {
  return (
    <footer className={`app-footer ${className}`.trim()}>
      <span>© 2026 LoadLab. All rights reserved.</span>
      <span aria-hidden="true">·</span>
      <span>Built by Abhay Agrawal</span>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/itsabhay1" target="_blank" rel="noopener noreferrer">
        @itsabhay1
      </a>
    </footer>
  );
}

export function AuthFooter() {
  return (
    <footer className="auth-compact-footer">
      <span>© 2026 LoadLab</span>
      <span aria-hidden="true">·</span>
      <span>Built by Abhay Agrawal</span>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/itsabhay1" target="_blank" rel="noopener noreferrer">
        @itsabhay1
      </a>
    </footer>
  );
}
