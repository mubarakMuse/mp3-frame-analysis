import { Router, type NextFunction, type Request, type Response } from 'express'
import multer, { MulterError } from 'multer'

import { AppError } from '../errors/app-error.js'
import { countMp3Frames } from '../services/count-mp3-frames.js'
import type { ErrorResponse, FrameCountResponse } from '../types/mp3.js'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

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

export const handleUploadErrors = (
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(error)
    return
  }

  if (error instanceof MulterError) {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    const body: ErrorResponse = {
      error: error.code,
      message:
        error.code === 'LIMIT_FILE_SIZE'
          ? `File too large. Maximum upload size is ${MAX_UPLOAD_BYTES} bytes`
          : error.message,
    }
    res.status(statusCode).json(body)
    return
  }

  if (error instanceof AppError) {
    const body: ErrorResponse = {
      error: error.name,
      message: error.message,
    }
    res.status(error.statusCode).json(body)
    return
  }

  const body: ErrorResponse = {
    error: 'InternalServerError',
    message: 'An unexpected error occurred',
  }
  res.status(500).json(body)
}
