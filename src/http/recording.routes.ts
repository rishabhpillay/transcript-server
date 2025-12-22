// routes/user.routes.ts
import { Router, Request, Response } from "express";
import Recording from '../models/Recording.js';

const router = Router();

type recordingsBody = {
  userId?: string;
};

// POST /user
router.post("/get", async (req: Request<{}, {}, recordingsBody>, res: Response) => {
  try {
    const { userId } = req.body || {};
    // console.log({body: req.body});
    // console.log({req: req});
    

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Look up by userId
    const recordings = await Recording.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

    return res.status(200).json(recordings);
  } catch (error: any) {
    console.error("Error creating or updating user:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }

});

export default router;
