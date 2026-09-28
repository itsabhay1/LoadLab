import { useEffect, useState } from 'react';
import { Check, Clipboard, Globe2, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageMessage } from '../components/run-widgets';
import { api } from '../services/api';

function statusLabel(target, failures) {
  if (failures[target._id]) return 'VERIFICATION FAILED';
  return target.status;
}

export function Targets() {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState({ name: '', baseUrl: '' });
  const [saving, setSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState();
  const [failures, setFailures] = useState({});
  const [copiedId, setCopiedId] = useState();
  const [error, setError] = useState();

  useEffect(() => {
    const controller = new AbortController();
    api
      .listTargets({ signal: controller.signal })
      .then((response) => setTargets(response.targets))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const create = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const response = await api.createTarget(values);
      setTargets((current) => [response.target, ...current]);
      setValues({ name: '', baseUrl: '' });
      setShowForm(false);
    } catch (createError) {
      setError(createError);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (target) => {
    setVerifyingId(target._id);
    setError(undefined);
    setFailures((current) => ({ ...current, [target._id]: undefined }));
    try {
      const response = await api.verifyTarget(target._id);
      setTargets((current) =>
        current.map((item) => (item._id === target._id ? response.target : item)),
      );
    } catch (verifyError) {
      setFailures((current) => ({ ...current, [target._id]: verifyError.message }));
    } finally {
      setVerifyingId(undefined);
    }
  };

  const remove = async (target) => {
    if (!window.confirm(`Delete “${target.name}”? Existing plans will no longer run.`)) return;
    try {
      await api.deleteTarget(target._id);
      setTargets((current) => current.filter((item) => item._id !== target._id));
    } catch (removeError) {
      setError(removeError);
    }
  };

  const copy = async (target) => {
    try {
      await navigator.clipboard.writeText(target.verificationToken);
      setCopiedId(target._id);
      setTimeout(() => setCopiedId(undefined), 1_500);
    } catch {
      setError(new Error('Could not copy the token. Select and copy it manually.'));
    }
  };

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUTHORIZED DESTINATIONS</p>
          <h1>Verified targets</h1>
          <p className="page-subtitle">
            Prove control of an API before LoadLab can send external test traffic.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus /> Add target
        </Button>
      </div>

      {showForm && (
        <Card className="plan-form-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Add external target</CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowForm(false)}
                aria-label="Close target form"
              >
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form className="target-form" onSubmit={create}>
              <label className="field">
                Target name
                <input
                  required
                  maxLength="100"
                  value={values.name}
                  onChange={(event) => setValues({ ...values, name: event.target.value })}
                />
              </label>
              <label className="field">
                Base URL
                <input
                  required
                  type="url"
                  placeholder="https://api.example.com"
                  value={values.baseUrl}
                  onChange={(event) => setValues({ ...values, baseUrl: event.target.value })}
                />
                <small>Use only the HTTP(S) origin. Custom ports and URL paths are blocked.</small>
              </label>
              <div className="form-actions">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Adding…' : 'Add target'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {error && (
        <PageMessage title="Could not complete the request" tone="error">
          {error.message}
        </PageMessage>
      )}
      {loading ? (
        <PageMessage title="Loading targets" />
      ) : targets.length === 0 ? (
        <PageMessage title="No verified targets yet">
          Add an API you control, publish its verification token, and verify ownership.
        </PageMessage>
      ) : (
        <div className="target-grid">
          {targets.map((target) => {
            const label = statusLabel(target, failures);
            return (
              <Card key={target._id} className="target-card">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <span className="service-icon">
                      {target.status === 'VERIFIED' ? <ShieldCheck /> : <Globe2 />}
                    </span>
                    <span
                      className={`target-status ${label === 'VERIFIED' ? 'verified' : label === 'PENDING' ? 'pending' : 'failed'}`}
                    >
                      {label}
                    </span>
                  </div>
                  <CardTitle className="mt-4">{target.name}</CardTitle>
                  <code className="plan-target">{target.baseUrl}</code>
                </CardHeader>
                <CardContent>
                  <div className="verification-instructions">
                    <p>Serve this exact token as plain text:</p>
                    <div className="token-row">
                      <code>{target.verificationToken}</code>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Copy verification token for ${target.name}`}
                        onClick={() => void copy(target)}
                      >
                        {copiedId === target._id ? <Check /> : <Clipboard />}
                      </Button>
                    </div>
                    <p>At this exact URL:</p>
                    <code className="verification-url">{target.verificationUrl}</code>
                  </div>
                  {failures[target._id] && (
                    <div className="target-failure" role="alert">
                      {failures[target._id]}
                    </div>
                  )}
                  <div className="target-actions">
                    <Button
                      variant="outline"
                      onClick={() => void verify(target)}
                      disabled={verifyingId === target._id}
                    >
                      <ShieldCheck />
                      {verifyingId === target._id ? 'Verifying…' : 'Verify'}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${target.name}`}
                      onClick={() => void remove(target)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
