import { Request, Response, NextFunction } from 'express';
import User from '../models/User.js';

export const checkUser = async (req: Request, res: Response, next: NextFunction) => {
  const uid = req.user;
  console.log({uid});
  

  if (!uid) {
    return res.status(400).json({ message: 'UID is required' });
  }

  try {
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};
