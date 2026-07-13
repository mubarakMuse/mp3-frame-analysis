import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'

import { AppError } from '../errors/app-error.js'
import { MAX_UPLOAD_BYTES } from '../middleware/error-handler.js'
import { countMp3Frames } from '../services/count-mp3-frames.js'
import type { FrameCountResponse } from '../types/mp3.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
})

export const fileUploadRouter = Router()

const handleFileUpload = (req: Request, res: Response, next: NextFunction): void => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded. Send a multipart field named "file".', 400)
    }

    if (req.file.size === 0) {
      throw new AppError('Uploaded file is empty', 400)
    }

    const frameCount = countMp3Frames(req.file.buffer)
    const body: FrameCountResponse = { frameCount }
    res.status(200).json(body)
  } catch (error) {
    next(error)
  }
}

fileUploadRouter.post('/file-upload', upload.single('file'), handleFileUpload)
