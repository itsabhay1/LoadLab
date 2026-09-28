import { Router } from 'express';
import {
  createTarget,
  deleteTarget,
  getTarget,
  listTargets,
  verifyTarget,
} from '../controllers/target-controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.route('/targets').post(createTarget).get(listTargets);
router.route('/targets/:targetId').get(getTarget).delete(deleteTarget);
router.post('/targets/:targetId/verify', verifyTarget);

export default router;
