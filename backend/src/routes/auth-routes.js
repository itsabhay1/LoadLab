import { Router } from 'express';
import { google, login, logout, me, refresh, register } from '../controllers/auth-controller.js';
import { authenticate } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/auth-rate-limit.js';

const router = Router();

router.post('/auth/register', authRateLimit, register);
router.post('/auth/login', authRateLimit, login);
router.post('/auth/google', authRateLimit, google);
router.post('/auth/refresh', refresh);
router.post('/auth/logout', logout);
router.get('/auth/me', authenticate, me);

export default router;
