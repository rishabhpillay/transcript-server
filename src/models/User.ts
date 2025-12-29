import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const UserSchema = new mongoose.Schema({
  displayName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  photoURL: { type: String },
  // Ensure every user gets a unique uid to satisfy existing unique index
  uid: { type: String, required: true, unique: true, default: uuidv4 },
});

const User = mongoose.model('User', UserSchema);

export default User;
