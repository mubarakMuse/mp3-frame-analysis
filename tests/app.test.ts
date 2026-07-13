import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'

describe('createApp', () => {
  it('creates an express application', () => {
    const app = createApp()
    expect(app).toBeDefined()
  })
})
