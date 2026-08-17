import { Router } from 'express';
import { authenticate } from '@/middleware/auth.js';
import { validate } from '@/middleware/validate.js';
import { registerSchema, loginSchema } from '@/schemas/auth.schema.js';
import { authController } from '@/controllers/auth.controller.js';
import { authLimiter } from '@/middleware/rateLimiter.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);

export default router;