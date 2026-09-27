import mongoose from 'mongoose';

const testPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    targetUrl: { type: String, required: true },
    virtualUsers: { type: Number, required: true, min: 1, max: 1000 },
    durationMs: { type: Number, required: true, min: 50, max: 300_000 },
    rampUpMs: { type: Number, required: true, min: 0, max: 60_000 },
    requestTimeoutMs: { type: Number, required: true, min: 10, max: 30_000 },
    maxConnections: { type: Number, required: true, min: 1, max: 100 },
    requestsPerSecond: { type: Number, required: true, min: 1, max: 5_000 },
  },
  { timestamps: true, versionKey: false },
);

export const TestPlan = mongoose.models.TestPlan ?? mongoose.model('TestPlan', testPlanSchema);
