import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'

import { AppError } from '../errors/app-error.js'
import { MAX_UPLOAD_BYTES } from '../middleware/error-handler.js'
import { countMp3FramesFromFile } from '../services/count-mp3-frames.js'
import type { FrameCountResponse } from '../types/mp3.js'

const uploadsDirectory = join(process.cwd(), 'uploads')
mkdirSync(uploadsDirectory, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, uploadsDirectory)
    },
    filename: (_req, _file, callback) => {
      callback(null, `${randomUUID()}.mp3`)
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
})

export const fileUploadRouter = Router()

const removeUploadedFile = async (filePath: string | undefined): Promise<void> => {
  if (!filePath) {
    return
  }

  try {
    await unlink(filePath)
  } catch {
    // Best-effort cleanup — avoid masking the original request error
  }
}

const handleFileUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const uploadedPath = req.file?.path

  try {
    if (!req.file) {
      throw new AppError('No file uploaded. Send a multipart field named "file".', 400)
    }

    if (req.file.size === 0) {
      throw new AppError('Uploaded file is empty', 400)
    }

    const frameCount = await countMp3FramesFromFile(req.file.path)
    const body: FrameCountResponse = { frameCount }
    res.status(200).json(body)
  } catch (error) {
    next(error)
  } finally {
    await removeUploadedFile(uploadedPath)
  }
}

fileUploadRouter.post('/file-upload', upload.single('file'), (req, res, next) => {
  void handleFileUpload(req, res, next)
})
