import { useEffect, useState } from 'react';
import { Edit3, FlaskConical, Play, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageMessage } from '../components/run-widgets';
import { api } from '../services/api';

const DEFAULT_PLAN = {
  name: '',
  targetMode: 'LOCAL',
  targetUrl: 'http://127.0.0.1:5050/fast',
  targetId: '',
  endpointPath: '/api/products',
  method: 'GET',
  requestHeadersText: '{}',
  requestBodyText: '',
  virtualUsers: 10,
  durationMs: 10_000,
  rampUpMs: 2_000,
  requestTimeoutMs: 3_000,
  maxConnections: 10,
  requestsPerSecond: 100,
};
const NUMERIC_FIELDS = new Set([
  'virtualUsers',
  'durationMs',
  'rampUpMs',
  'requestTimeoutMs',
  'maxConnections',
  'requestsPerSecond',
]);

function planValues(plan) {
  if (!plan) return DEFAULT_PLAN;
  return {
    ...DEFAULT_PLAN,
    ...plan,
    targetMode: plan.targetMode ?? 'LOCAL',
    targetId: plan.target ?? '',
    requestHeadersText: JSON.stringify(plan.requestHeaders ?? {}, null, 2),
    requestBodyText:
      plan.requestBody === undefined || plan.requestBody === null
        ? ''
        : JSON.stringify(plan.requestBody, null, 2),
  };
}

function PlanForm({ plan, targets, onSaved, onClose }) {
  const [values, setValues] = useState(() => planValues(plan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState();
  const editing = Boolean(plan?._id);
  const change = ({ target }) =>
    setValues((current) => ({
      ...current,
      [target.name]: NUMERIC_FIELDS.has(target.name) ? Number(target.value) : target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const payload = {
        name: values.name,
        targetMode: values.targetMode,
        virtualUsers: values.virtualUsers,
        durationMs: values.durationMs,
        rampUpMs: values.rampUpMs,
        requestTimeoutMs: values.requestTimeoutMs,
        maxConnections: values.maxConnections,
        requestsPerSecond: values.requestsPerSecond,
        ...(values.targetMode === 'LOCAL'
          ? { targetUrl: values.targetUrl }
          : {
              targetId: values.targetId,
              endpointPath: values.endpointPath,
              method: values.method,
              requestHeaders: JSON.parse(values.requestHeadersText || '{}'),
              requestBody: values.requestBodyText.trim()
                ? JSON.parse(values.requestBodyText)
                : null,
            }),
      };
      const response = editing
        ? await api.updatePlan(plan._id, payload)
        : await api.createPlan(payload);
      onSaved(response.plan);
    } catch (submitError) {
      setError(submitError);
    } finally {
      setSaving(false);
    }
  };
  const fields = [
    ['virtualUsers', 'Virtual users', 1, 1000],
    ['durationMs', 'Duration (ms)', 50, 300000],
    ['rampUpMs', 'Ramp-up (ms)', 0, 60000],
    ['requestTimeoutMs', 'Timeout (ms)', 10, 30000],
    ['maxConnections', 'Connection limit', 1, 100],
    ['requestsPerSecond', 'Request starts / sec', 1, 5000],
  ];
  return (
    <Card className="plan-form-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{editing ? 'Edit test plan' : 'Create test plan'}</CardTitle>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close plan form">
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form className="plan-form" onSubmit={submit}>
          <label className="field field-wide">
            Plan name
            <input name="name" required maxLength="100" value={values.name} onChange={change} />
          </label>
          <label className="field field-wide">
            Target mode
            <select name="targetMode" value={values.targetMode} onChange={change}>
              <option value="LOCAL">Development / Local Test Mode</option>
              <option value="EXTERNAL">Verified external target</option>
            </select>
          </label>
          {values.targetMode === 'LOCAL' ? (
            <label className="field field-wide">
              Local target URL
              <input
                name="targetUrl"
                type="url"
                required
                value={values.targetUrl}
                onChange={change}
              />
              <small>
                Development only: /fast, /slow, /variable or /flaky on the local mock server.
              </small>
            </label>
          ) : (
            <>
              <label className="field">
                Verified target
                <select name="targetId" required value={values.targetId} onChange={change}>
                  <option value="">Select a verified target</option>
                  {targets
                    .filter((target) => target.status === 'VERIFIED')
                    .map((target) => (
                      <option key={target._id} value={target._id}>
                        {target.name} — {target.baseUrl}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                HTTP method
                <select name="method" value={values.method} onChange={change}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
              </label>
              <label className="field field-wide">
                Endpoint path
                <input
                  name="endpointPath"
                  required
                  placeholder="/api/products"
                  value={values.endpointPath}
                  onChange={change}
                />
                <small>The path must stay on the selected verified hostname.</small>
              </label>
              <label className="field field-wide">
                Request headers (JSON object)
                <textarea
                  name="requestHeadersText"
                  rows="4"
                  value={values.requestHeadersText}
                  onChange={change}
                />
              </label>
              <label className="field field-wide">
                Optional JSON request body
                <textarea
                  name="requestBodyText"
                  rows="5"
                  placeholder='{"query":"loadlab"}'
                  value={values.requestBodyText}
                  onChange={change}
                />
              </label>
            </>
          )}
          {fields.map(([name, label, min, max]) => (
            <label className="field" key={name}>
              {label}
              <input
                name={name}
                type="number"
                min={min}
                max={max}
                required
                value={values[name]}
                onChange={change}
              />
            </label>
          ))}
          {error && (
            <div className="form-error" role="alert">
              {error.message}
            </div>
          )}
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function TestPlans() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState();
  const [editor, setEditor] = useState(null);
  const [startingId, setStartingId] = useState();
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.listPlans({ signal: controller.signal }),
      api.listTargets({ signal: controller.signal }),
    ])
      .then(([planResponse, targetResponse]) => {
        setPlans(planResponse.plans);
        setTargets(targetResponse.targets);
        setError(undefined);
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  const saved = (plan) => {
    setPlans((current) => {
      const found = current.some((item) => item._id === plan._id);
      return found
        ? current.map((item) => (item._id === plan._id ? plan : item))
        : [plan, ...current];
    });
    setEditor(null);
  };
  const remove = async (plan) => {
    if (!window.confirm(`Delete “${plan.name}”?`)) return;
    try {
      await api.deletePlan(plan._id);
      setPlans((current) => current.filter((item) => item._id !== plan._id));
    } catch (removeError) {
      setError(removeError);
    }
  };
  const start = async (plan) => {
    setStartingId(plan._id);
    setError(undefined);
    try {
      const response = await api.startRun(plan._id);
      navigate(`/runs/${response.runId}/live`);
    } catch (startError) {
      setError(startError);
      setStartingId(undefined);
    }
  };
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TEST MANAGEMENT</p>
          <h1>Test plans</h1>
          <p className="page-subtitle">
            Configure local development tests or APIs you have verified and control.
          </p>
        </div>
        <Button onClick={() => setEditor(DEFAULT_PLAN)}>
          <Plus />
          New plan
        </Button>
      </div>
      {editor && (
        <PlanForm
          plan={editor._id ? editor : undefined}
          targets={targets}
          onSaved={saved}
          onClose={() => setEditor(null)}
        />
      )}
      {error && (
        <PageMessage title="Could not complete the request" tone="error">
          {error.message}
        </PageMessage>
      )}
      {loading ? (
        <PageMessage title="Loading test plans" />
      ) : plans.length === 0 ? (
        <PageMessage title="No test plans yet">
          Create a plan to run your first local load test.
        </PageMessage>
      ) : (
        <div className="plan-grid">
          {plans.map((plan) => (
            <Card key={plan._id} className="plan-card">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <span className="service-icon">
                    <FlaskConical size={20} />
                  </span>
                  <div className="row-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${plan.name}`}
                      onClick={() => setEditor(plan)}
                    >
                      <Edit3 />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${plan.name}`}
                      onClick={() => void remove(plan)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <CardTitle className="mt-4">{plan.name}</CardTitle>
                <span className={`plan-mode ${plan.targetMode === 'EXTERNAL' ? 'external' : ''}`}>
                  {plan.targetMode === 'EXTERNAL' ? 'VERIFIED EXTERNAL' : 'DEVELOPMENT / LOCAL'}
                </span>
                <code className="plan-target">{plan.targetUrl}</code>
              </CardHeader>
              <CardContent>
                <dl className="plan-stats">
                  <div>
                    <dt>Virtual users</dt>
                    <dd>{plan.virtualUsers}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{plan.durationMs / 1000}s</dd>
                  </div>
                  <div>
                    <dt>Ramp-up</dt>
                    <dd>{plan.rampUpMs / 1000}s</dd>
                  </div>
                  <div>
                    <dt>Rate limit</dt>
                    <dd>{plan.requestsPerSecond}/s</dd>
                  </div>
                </dl>
                <Button
                  className="w-full mt-5"
                  onClick={() => void start(plan)}
                  disabled={
                    Boolean(startingId) ||
                    (plan.targetMode === 'EXTERNAL' &&
                      !targets.some(
                        (target) => target._id === plan.target && target.status === 'VERIFIED',
                      ))
                  }
                  title={
                    plan.targetMode === 'EXTERNAL' &&
                    !targets.some(
                      (target) => target._id === plan.target && target.status === 'VERIFIED',
                    )
                      ? 'The external target is no longer verified.'
                      : undefined
                  }
                >
                  <Play />
                  {startingId === plan._id ? 'Starting…' : 'Start test'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
