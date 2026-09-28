import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: { type: String, select: false },
    googleId: { type: String, trim: true, select: false },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_document, value) {
        delete value.password;
        delete value.googleId;
        return value;
      },
    },
  },
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);

userSchema.pre('validate', function requireAuthenticationMethod() {
  if (!this.password && !this.googleId) {
    this.invalidate('password', 'A password or Google account is required.');
  }
});

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
