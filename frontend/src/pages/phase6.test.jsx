// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Targets } from './targets';
import { TestPlans } from './test-plans';
import { api, ApiError } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: {
      listTargets: vi.fn(),
      createTarget: vi.fn(),
      verifyTarget: vi.fn(),
      deleteTarget: vi.fn(),
      listPlans: vi.fn(),
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
      startRun: vi.fn(),
    },
  };
});

const target = {
  _id: '507f1f77bcf86cd799439013',
  name: 'Owned API',
  baseUrl: 'https://api.example.com',
  hostname: 'api.example.com',
  verificationToken: 'a'.repeat(64),
  verificationUrl: 'https://api.example.com/.well-known/loadlab-verification.txt',
  status: 'PENDING',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listTargets.mockResolvedValue({ targets: [target] });
  api.listPlans.mockResolvedValue({ plans: [] });
  api.deleteTarget.mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue() },
  });
  window.confirm = vi.fn(() => true);
});

afterEach(cleanup);

describe('verified-target workflow', () => {
  it('shows verification instructions, copies the token and verifies the target', async () => {
    api.verifyTarget.mockResolvedValue({
      target: { ...target, status: 'VERIFIED', verifiedAt: new Date().toISOString() },
    });
    render(<Targets />);
    expect(await screen.findByText('PENDING')).toBeInTheDocument();
    expect(screen.getByText(target.verificationUrl)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: `Copy verification token for ${target.name}` }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(target.verificationToken);
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('VERIFIED')).toBeInTheDocument();
  });

  it('shows a clear verification-failed state without marking the target verified', async () => {
    api.verifyTarget.mockRejectedValue(
      new ApiError('The verification token did not match.', { code: 'VERIFICATION_MISMATCH' }),
    );
    render(<Targets />);
    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('VERIFICATION FAILED')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('verification token did not match');
  });

  it('creates an external plan from a verified target and safe endpoint path', async () => {
    const verified = { ...target, status: 'VERIFIED' };
    api.listTargets.mockResolvedValue({ targets: [verified] });
    api.createPlan.mockImplementation(async (plan) => ({
      plan: { _id: '507f1f77bcf86cd799439014', ...plan, target: plan.targetId },
    }));
    render(
      <MemoryRouter>
        <TestPlans />
      </MemoryRouter>,
    );
    await screen.findByText('No test plans yet');
    await userEvent.click(screen.getByRole('button', { name: 'New plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), 'External smoke test');
    await userEvent.selectOptions(screen.getByLabelText('Target mode'), 'EXTERNAL');
    await userEvent.selectOptions(screen.getByLabelText('Verified target'), verified._id);
    await userEvent.selectOptions(screen.getByLabelText('HTTP method'), 'POST');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await waitFor(() =>
      expect(api.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          targetMode: 'EXTERNAL',
          targetId: verified._id,
          endpointPath: '/api/products',
          method: 'POST',
        }),
      ),
    );
  });
});
