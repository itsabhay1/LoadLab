import { useCallback, useState } from 'react';
import { Activity, ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { GoogleSignIn } from '../components/google-sign-in';
import { useAuth } from '../context/auth-context';

export function Login() {
  const { user, login, googleLogin, sessionMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState();
  const [submitting, setSubmitting] = useState(false);
  const destination = location.state?.from?.pathname ?? '/';
  const complete = useCallback(
    () => navigate(destination, { replace: true }),
    [navigate, destination],
  );
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await login(values);
      complete();
    } catch (loginError) {
      setError(loginError);
      setSubmitting(false);
    }
  };
  const google = useCallback(
    async (credential) => {
      setSubmitting(true);
      setError(undefined);
      try {
        await googleLogin(credential);
        complete();
      } catch (googleError) {
        setError(googleError);
        setSubmitting(false);
      }
    },
    [googleLogin, complete],
  );
  const googleError = useCallback((loadError) => setError(loadError), []);
  if (user) return <Navigate to="/" replace />;
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link to="/login" className="auth-brand">
          <span>
            <Activity />
          </span>
          LoadLab.
        </Link>
        <div>
          <p className="eyebrow">PERFORMANCE, WITH CLARITY</p>
          <h1>
            Understand your API
            <br />
            under pressure.
          </h1>
          <p>
            Design controlled tests, watch live aggregate metrics and keep every result tied to your
            workspace.
          </p>
        </div>
        <small>Local targets · Controlled load · Actionable metrics</small>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to LoadLab</h2>
          <p className="auth-intro">Continue to your performance workspace.</p>
          {(error || sessionMessage) && (
            <div className="auth-error" role="alert">
              {error?.message ?? sessionMessage}
            </div>
          )}
          <form className="auth-form" onSubmit={submit}>
            <label>
              Email address
              <div className="auth-input">
                <Mail />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={values.email}
                  onChange={(event) => setValues({ ...values, email: event.target.value })}
                />
              </div>
            </label>
            <label>
              Password
              <div className="auth-input">
                <LockKeyhole />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={values.password}
                  onChange={(event) => setValues({ ...values, password: event.target.value })}
                />
              </div>
            </label>
            <Button type="submit" disabled={submitting} className="auth-submit">
              {submitting ? 'Signing in…' : 'Sign in'}
              <ArrowRight />
            </Button>
          </form>
          <div className="auth-divider">
            <span>or</span>
          </div>
          <GoogleSignIn onCredential={google} onError={googleError} disabled={submitting} />
          <p className="auth-switch">
            New to LoadLab? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
