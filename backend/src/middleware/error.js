import { logger, errorKind } from '../config/logger.js';

export function createHttpError(status, code, message) {
  return Object.assign(new Error(message), { status, code, publicMessage: message });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    logger.error({ event: 'response_failed', requestId: req.id, kind: errorKind(error) });
    return next(new Error('Response could not be completed.'));
  }
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected server error occurred.';
  if (Number.isInteger(error.status) && error.status < 500 && error.code && error.publicMessage) {
    status = error.status;
    code = error.code;
    message = error.publicMessage;
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body exceeds the 32 KB limit.';
  } else if (error.status === 415) {
    status = 415;
    code = 'UNSUPPORTED_ENCODING';
    message = 'Unsupported request encoding.';
  } else if (error.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Stored data did not pass validation.';
  } else if (error.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'Resource ID is invalid.';
  } else if (error.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'A conflicting resource already exists.';
  }
  logger[status >= 500 ? 'error' : 'warn']({
    event: 'request_failed',
    requestId: req.id,
    status,
    code,
    kind: errorKind(error),
  });
  const body = { code, message, requestId: req.id };
  if (req.app.get('env') === 'development') body.diagnostics = { kind: errorKind(error) };
  return res.status(status).json({ error: body });
}
