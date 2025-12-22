// routes/user.routes.ts
import { Router, Request, Response } from "express";
import User from "../models/User.js"; // adjust path if needed

const router = Router();

type CreateOrUpdateBody = {
  displayName?: string;
  email: string;
  photoURL?: string;
  uid?: string;
};

// POST /user
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';

// Secret key for JWT (should be in env, using fallback for now if missing - assuming env.JWT_SECRET might not exist yet)
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me';

// POST /register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { displayName, password, email } = req.body;

    if (!displayName || !password || !email) {
      return res.status(400).json({ message: "Display Name, password, and email are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      displayName,
      password: hashedPassword,
      email,
      photoURL: undefined
    });

    await user.save();

    const token = jwt.sign({ _id: user._id, displayName: user.displayName }, JWT_SECRET, { expiresIn: '7d' });

    const userResponse = user.toObject();
    delete (userResponse as any).password;

    return res.status(201).json({ user: userResponse, token });
  } catch (error: any) {
    console.error("Register Error:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }
});

// POST /login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find by Email Only
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // @ts-ignore
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ _id: user._id, displayName: user.displayName }, JWT_SECRET, { expiresIn: '7d' });

    const userResponse = user.toObject();
    delete (userResponse as any).password;

    return res.status(200).json({ user: userResponse, token });
  } catch (error: any) {
    console.error("Login Error:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }
});

// Keep generic set for legacy or other updates if needed, but modified
router.post("/set", async (req: Request<{}, {}, CreateOrUpdateBody>, res: Response) => {
    // Deprecated for auth purposes, keeping for profile updates if needed
    // Logic here depends on if you want to allow updating user details without auth... assuming this was internal
    // For now, removing the old logic to force use of new auth flow as requested
    return res.status(410).json({ message: "Use /register or /login" });
});

export default router;
