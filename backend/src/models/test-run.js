import mongoose from 'mongoose';

export const RUN_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
});

export const ACTIVE_RUN_STATUSES = [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING];

const configurationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    targetUrl: { type: String, required: true },
    virtualUsers: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    rampUpMs: { type: Number, required: true },
    requestTimeoutMs: { type: Number, required: true },
    maxConnections: { type: Number, required: true },
    requestsPerSecond: { type: Number, required: true },
  },
  { _id: false },
);

const snapshotSchema = new mongoose.Schema(
  {
    capturedAt: { type: Date, required: true },
    metrics: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const testRunSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'TestPlan', required: true, index: true },
    configurationSnapshot: { type: configurationSchema, required: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUN_STATUS),
      default: RUN_STATUS.QUEUED,
      index: true,
    },
    queuedAt: { type: Date, required: true, default: Date.now },
    startedAt: Date,
    finishedAt: Date,
    finalMetrics: mongoose.Schema.Types.Mixed,
    snapshots: { type: [snapshotSchema], default: [] },
    reason: { type: String, maxlength: 300 },
  },
  { timestamps: true, versionKey: false },
);

testRunSchema.index({ owner: 1, createdAt: -1 });

export const TestRun = mongoose.models.TestRun ?? mongoose.model('TestRun', testRunSchema);
