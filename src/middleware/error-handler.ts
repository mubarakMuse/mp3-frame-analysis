import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'

import { AppError } from '../errors/app-error.js'
import type { ErrorResponse } from '../types/mp3.js'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export const handleNotFound = (_req: Request, res: Response): void => {
  const body: ErrorResponse = {
    error: 'NotFound',
    message: 'Route not found',
  }
  res.status(404).json(body)
}

export const handleError = (
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
    const messageByCode: Record<string, string> = {
      LIMIT_FILE_SIZE: `File too large. Maximum upload size is ${MAX_UPLOAD_BYTES} bytes`,
      LIMIT_UNEXPECTED_FILE:
        'Unexpected field. Upload the MP3 using the multipart field named "file".',
    }
    const body: ErrorResponse = {
      error: error.code,
      message: messageByCode[error.code] ?? error.message,
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

  console.error('Unhandled error:', error)

  const body: ErrorResponse = {
    error: 'InternalServerError',
    message: 'An unexpected error occurred',
  }
  res.status(500).json(body)
}
