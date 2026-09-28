import mongoose from 'mongoose';

export const TARGET_STATUS = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
});

const targetSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    baseUrl: { type: String, required: true },
    hostname: { type: String, required: true, lowercase: true, trim: true },
    verificationToken: { type: String, required: true, minlength: 64, maxlength: 64 },
    status: {
      type: String,
      required: true,
      enum: Object.values(TARGET_STATUS),
      default: TARGET_STATUS.PENDING,
      index: true,
    },
    verifiedAt: Date,
  },
  { timestamps: true, versionKey: false },
);

targetSchema.index({ owner: 1, createdAt: -1 });
targetSchema.index({ owner: 1, baseUrl: 1 }, { unique: true });

export const Target = mongoose.models.Target ?? mongoose.model('Target', targetSchema);
