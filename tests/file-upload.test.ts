import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const sampleMp3 = readFileSync(join(fixturesDir, 'sample.mp3'))

describe('POST /file-upload', () => {
  const app = createApp()

  it('returns the frame count for a valid MPEG-1 Layer III file', async () => {
    const response = await request(app).post('/file-upload').attach('file', sampleMp3, 'sample.mp3')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(response.body).toEqual({ frameCount: 6089 })
  })

  it('returns 400 when no file is uploaded', async () => {
    const response = await request(app).post('/file-upload')

    expect(response.status).toBe(400)
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(response.body).toMatchObject({
      error: 'AppError',
      message: expect.stringContaining('No file uploaded'),
    })
  })

  it('returns 400 when the multipart field name is wrong', async () => {
    const response = await request(app)
      .post('/file-upload')
      .attach('audio', sampleMp3, 'sample.mp3')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      error: 'LIMIT_UNEXPECTED_FILE',
      message: expect.stringContaining('multipart field named "file"'),
    })
  })

  it('returns 400 for an empty uploaded file', async () => {
    const response = await request(app)
      .post('/file-upload')
      .attach('file', Buffer.alloc(0), 'empty.mp3')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      error: 'AppError',
      message: expect.stringContaining('empty'),
    })
  })

  it('returns 400 for a non-MP3 payload', async () => {
    const response = await request(app)
      .post('/file-upload')
      .attach('file', Buffer.from('not an mp3'), 'notes.txt')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      error: 'AppError',
      message: expect.stringContaining('MPEG Version 1 Audio Layer III'),
    })
  })
})

describe('unknown routes', () => {
  const app = createApp()

  it('returns 404 JSON for unknown paths', async () => {
    const response = await request(app).get('/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(response.body).toEqual({
      error: 'NotFound',
      message: 'Route not found',
    })
  })
})
