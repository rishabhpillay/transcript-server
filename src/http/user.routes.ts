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
router.post("/set", async (req: Request<{}, {}, CreateOrUpdateBody>, res: Response) => {
  try {
    const { displayName, email, photoURL, uid } = req.body || {};

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Look up by email (you could also key by Firebase uid)
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user
      user.displayName = displayName ?? user.displayName;
      user.photoURL = photoURL ?? user.photoURL;
      user.uid = uid ?? user.uid;
      await user.save();
      return res.status(200).json(user);
    }

    // Create new user
    user = new User({ displayName, email, photoURL, uid });
    await user.save();
    return res.status(201).json(user);
  } catch (error: any) {
    console.error("Error creating or updating user:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }

});

export default router;
