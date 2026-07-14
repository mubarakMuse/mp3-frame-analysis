import type { NextFunction, Request, Response } from 'express'

import { AppError } from '../errors/app-error.js'
import type { ErrorResponse } from '../types/mp3.js'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY ?? 4)

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
