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
import { authenticate } from '../middleware/auth.js';
import { compareRuns, exportRun, getOverview } from '../controllers/run-report-controller.js';

const router = Router();

router.use(authenticate);

router.route('/plans').post(createPlan).get(listPlans);
router.route('/plans/:planId').get(getPlan).patch(updatePlan).delete(deletePlan);
router.post('/plans/:planId/runs', startRun);
router.get('/overview', getOverview);
router.get('/runs', listRuns);
router.get('/runs/compare', compareRuns);
router.get('/runs/:runId/export', exportRun);
router.get('/runs/:runId', getRun);
router.post('/runs/:runId/cancel', cancelRun);

export default router;
