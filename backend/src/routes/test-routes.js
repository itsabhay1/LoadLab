import { Router } from 'express';
import {
  cancelRun,
  createPlan,
  deletePlan,
  getPlan,
  getRun,
  listPlans,
  listRuns,
  startRun,
  updatePlan,
} from '../controllers/test-controller.js';
import { createHttpError } from '../middleware/error.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function localExecutionOnly(req, _res, next) {
  const address = req.socket.remoteAddress;
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return next();
  return next(
    createHttpError(403, 'LOCAL_EXECUTION_ONLY', 'Test execution is restricted to local requests.'),
  );
}

router.use(authenticate);

router.route('/plans').post(createPlan).get(listPlans);
router.route('/plans/:planId').get(getPlan).patch(updatePlan).delete(deletePlan);
router.post('/plans/:planId/runs', localExecutionOnly, startRun);
router.get('/runs', listRuns);
router.get('/runs/:runId', getRun);
router.post('/runs/:runId/cancel', localExecutionOnly, cancelRun);

export default router;
