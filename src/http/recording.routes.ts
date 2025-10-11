// routes/user.routes.ts
import { Router, Request, Response } from "express";
import Recording from '../models/Recording.js';

const router = Router();

type recordingsBody = {
  uid?: string;
};

// POST /user
router.post("/get", async (req: Request<{}, {}, recordingsBody>, res: Response) => {
  try {
    const { uid } = req.body || {};
    console.log({body: req.body});
    console.log({req: req});
    

    if (!uid) {
      return res.status(400).json({ message: "uid is required" });
    }

    // Look up by email (you could also key by Firebase uid)
    const recordings = await Recording.find({ uid })
    .sort({ createdAt: -1 })
    .lean();

    return res.status(200).json(recordings);
  } catch (error: any) {
    console.error("Error creating or updating user:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }

});

export default router;
