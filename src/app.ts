import express from 'express'

import { fileUploadRouter, handleUploadErrors } from './routes/file-upload.js'

export const createApp = () => {
  const app = express()

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })

  app.use(fileUploadRouter)
  app.use(handleUploadErrors)

  return app
}
