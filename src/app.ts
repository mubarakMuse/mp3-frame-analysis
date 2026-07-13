import express from 'express'

import { handleError, handleNotFound } from './middleware/error-handler.js'
import { fileUploadRouter } from './routes/file-upload.js'

export const createApp = () => {
  const app = express()

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })

  app.use(fileUploadRouter)
  app.use(handleNotFound)
  app.use(handleError)

  return app
}
