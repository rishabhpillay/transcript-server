import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  displayName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  photoURL: { type: String },
  uid: { type: String, required: true, unique: true },
});

const User = mongoose.model('User', UserSchema);

export default User;
