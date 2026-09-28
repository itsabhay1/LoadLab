import { useCallback, useState } from 'react';
import { Activity, ArrowRight, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { GoogleSignIn } from '../components/google-sign-in';
import { useAuth } from '../context/auth-context';

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

export function Register() {
  const { user, register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState();
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!STRONG_PASSWORD.test(values.password)) {
      setError(new Error('Use 8–72 characters with uppercase, lowercase and a number.'));
      return;
    }
    if (values.password !== values.confirmPassword) {
      setError(new Error('Passwords do not match.'));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await register({ name: values.name, email: values.email, password: values.password });
      navigate('/', { replace: true });
    } catch (registerError) {
      setError(registerError);
      setSubmitting(false);
    }
  };
  const google = useCallback(
    async (credential) => {
      setSubmitting(true);
      setError(undefined);
      try {
        await googleLogin(credential);
        navigate('/', { replace: true });
      } catch (googleError) {
        setError(googleError);
        setSubmitting(false);
      }
    },
    [googleLogin, navigate],
  );
  const googleError = useCallback((loadError) => setError(loadError), []);
  if (user) return <Navigate to="/" replace />;
  const field = (name, label, Icon, type, autoComplete) => (
    <label>
      {label}
      <div className="auth-input">
        <Icon />
        <input
          name={name}
          type={type}
          autoComplete={autoComplete}
          required
          value={values[name]}
          onChange={(event) => setValues({ ...values, [name]: event.target.value })}
        />
      </div>
    </label>
  );
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
          <p className="eyebrow">BUILD YOUR WORKSPACE</p>
          <h1>
            Make performance
            <br />
            part of development.
          </h1>
          <p>
            Create repeatable local load tests and keep plans, live runs and historical results
            private to your account.
          </p>
        </div>
        <small>Up to 1000 VUs · Local-only targets · Secure ownership</small>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">CREATE YOUR ACCOUNT</p>
          <h2>Start using LoadLab</h2>
          <p className="auth-intro">Set up your private performance workspace.</p>
          {error && (
            <div className="auth-error" role="alert">
              {error.message}
            </div>
          )}
          <form className="auth-form" onSubmit={submit}>
            {field('name', 'Full name', UserRound, 'text', 'name')}
            {field('email', 'Email address', Mail, 'email', 'email')}
            {field('password', 'Password', LockKeyhole, 'password', 'new-password')}
            {field('confirmPassword', 'Confirm password', LockKeyhole, 'password', 'new-password')}
            <small className="password-hint">
              Use 8–72 characters with uppercase, lowercase and a number.
            </small>
            <Button type="submit" disabled={submitting} className="auth-submit">
              {submitting ? 'Creating account…' : 'Create account'}
              <ArrowRight />
            </Button>
          </form>
          <div className="auth-divider">
            <span>or</span>
          </div>
          <GoogleSignIn
            onCredential={google}
            onError={googleError}
            disabled={submitting}
            text="signup_with"
          />
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
