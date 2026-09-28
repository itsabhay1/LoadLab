import mongoose from 'mongoose';

const testPlanSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    targetMode: { type: String, enum: ['LOCAL', 'EXTERNAL'], default: 'LOCAL', required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Target' },
    endpointPath: { type: String, maxlength: 2_048 },
    targetUrl: { type: String, required: true },
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      default: 'GET',
      required: true,
    },
    requestHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestBody: mongoose.Schema.Types.Mixed,
    virtualUsers: { type: Number, required: true, min: 1, max: 1000 },
    durationMs: { type: Number, required: true, min: 50, max: 300_000 },
    rampUpMs: { type: Number, required: true, min: 0, max: 60_000 },
    requestTimeoutMs: { type: Number, required: true, min: 10, max: 30_000 },
    maxConnections: { type: Number, required: true, min: 1, max: 100 },
    requestsPerSecond: { type: Number, required: true, min: 1, max: 5_000 },
  },
  { timestamps: true, versionKey: false },
);

testPlanSchema.index({ owner: 1, createdAt: -1 });
testPlanSchema.index({ owner: 1, target: 1 });

export const TestPlan = mongoose.models.TestPlan ?? mongoose.model('TestPlan', testPlanSchema);
