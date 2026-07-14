import { pipeline } from 'node:stream/promises'
import Busboy from 'busboy'
import { Router, type NextFunction, type Request, type Response } from 'express'
import pLimit from 'p-limit'

import { AppError } from '../errors/app-error.js'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CONCURRENCY } from '../middleware/error-handler.js'
import { countMp3FramesFromStream } from '../services/count-mp3-frames.js'
import type { FrameCountResponse } from '../types/mp3.js'

const uploadLimit = pLimit(MAX_UPLOAD_CONCURRENCY)

/**
 * Parse multipart with Busboy and count frames from the upload stream as bytes
 * arrive. The whole file is never buffered in memory.
 */
const countFramesFromMultipartUpload = (req: Request): Promise<number> =>
  new Promise((resolve, reject) => {
    const contentType = req.headers['content-type']
    if (!contentType?.toLowerCase().includes('multipart/form-data')) {
      reject(new AppError('No file uploaded. Send a multipart field named "file".', 400))
      return
    }

    let settled = false
    let sawFileField = false

    const settleWithError = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    const settleWithResult = (frameCount: number): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(frameCount)
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_UPLOAD_BYTES,
        fields: 10,
      },
    })

    busboy.on('file', (fieldName, file) => {
      if (fieldName !== 'file') {
        file.resume()
        settleWithError(
          new AppError(
            'Unexpected field. Upload the MP3 using the multipart field named "file".',
            400,
          ),
        )
        return
      }

      sawFileField = true

      file.on('limit', () => {
        file.resume()
        settleWithError(
          new AppError(`File too large. Maximum upload size is ${MAX_UPLOAD_BYTES} bytes`, 413),
        )
      })

      // Async iteration over `file` respects stream backpressure
      void countMp3FramesFromStream(file)
        .then(settleWithResult)
        .catch((error: unknown) => {
          file.resume()
          settleWithError(error)
        })
    })

    busboy.on('error', (error: Error) => {
      settleWithError(error)
    })

    busboy.on('finish', () => {
      if (!sawFileField) {
        settleWithError(new AppError('No file uploaded. Send a multipart field named "file".', 400))
      }
    })

    void pipeline(req, busboy).catch((error: unknown) => {
      settleWithError(error)
    })
  })

export const fileUploadRouter = Router()

fileUploadRouter.post('/file-upload', (req: Request, res: Response, next: NextFunction) => {
  // Bound concurrent uploads so many streams cannot exhaust RAM/CPU
  void uploadLimit(async () => {
    try {
      const frameCount = await countFramesFromMultipartUpload(req)
      const body: FrameCountResponse = { frameCount }
      res.status(200).json(body)
    } catch (error) {
      next(error)
    }
  })
})
