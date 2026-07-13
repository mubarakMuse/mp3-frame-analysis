import { Router } from 'express'

export const fileUploadRouter = Router()

// POST /file-upload will be implemented in a later step
fileUploadRouter.post('/file-upload', (_req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    message: 'MP3 frame counting endpoint is not implemented yet',
  })
})
