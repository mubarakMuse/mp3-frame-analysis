import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import {
  countMp3Frames,
  countMp3FramesFromFile,
  countMp3FramesFromStream,
} from '../src/services/count-mp3-frames.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

/** Build a minimal MPEG-1 Layer III frame header + zeroed body. */
const buildMpeg1Layer3Frame = (options: {
  bitrateIndex: number
  sampleRateIndex: number
  padding?: 0 | 1
}): Buffer => {
  const { bitrateIndex, sampleRateIndex, padding = 0 } = options

  const b0 = 0xff
  // version=11, layer=01, protection=1 (no CRC)
  const b1 = 0b1111_1011
  const b2 = (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1)
  const b3 = 0b1100_0000 // stereo, no emphasis

  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const sampleRates = [44100, 48000, 32000]
  const bitrateKbps = bitrates[bitrateIndex]!
  const sampleRateHz = sampleRates[sampleRateIndex]!
  const frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRateHz) + padding

  const frame = Buffer.alloc(frameLength, 0)
  frame[0] = b0
  frame[1] = b1
  frame[2] = b2
  frame[3] = b3
  return frame
}

describe('countMp3Frames', () => {
  it('counts frames in the assessment sample MP3', () => {
    const sample = readFileSync(join(fixturesDir, 'sample.mp3'))
    // Verified with mediainfo / ffprobe (excludes Xing metadata frame)
    expect(countMp3Frames(sample)).toBe(6089)
  })

  it('counts synthetic consecutive MPEG-1 Layer III frames', () => {
    const frames = Buffer.concat([
      buildMpeg1Layer3Frame({ bitrateIndex: 5, sampleRateIndex: 0 }),
      buildMpeg1Layer3Frame({ bitrateIndex: 5, sampleRateIndex: 0 }),
      buildMpeg1Layer3Frame({ bitrateIndex: 5, sampleRateIndex: 0, padding: 1 }),
    ])

    expect(countMp3Frames(frames)).toBe(3)
  })

  it('skips an ID3v2 tag before counting frames', () => {
    const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const frame = buildMpeg1Layer3Frame({ bitrateIndex: 9, sampleRateIndex: 0 })
    const buffer = Buffer.concat([id3, frame, frame])

    expect(countMp3Frames(buffer)).toBe(2)
  })

  it('ignores a trailing ID3v1 tag', () => {
    const frame = buildMpeg1Layer3Frame({ bitrateIndex: 5, sampleRateIndex: 0 })
    const id3v1 = Buffer.alloc(128, 0)
    id3v1.write('TAG', 0, 'ascii')
    const buffer = Buffer.concat([frame, frame, id3v1])

    expect(countMp3Frames(buffer)).toBe(2)
  })

  it('throws AppError for an empty buffer', () => {
    expect(() => countMp3Frames(Buffer.alloc(0))).toThrow(AppError)
  })

  it('throws AppError when no MPEG-1 Layer III frames are present', () => {
    expect(() => countMp3Frames(Buffer.from('not an mp3'))).toThrow(AppError)
  })
})

describe('countMp3FramesFromFile', () => {
  it('matches the buffer parser for the assessment sample', async () => {
    const samplePath = join(fixturesDir, 'sample.mp3')
    const fromFile = await countMp3FramesFromFile(samplePath)
    const fromBuffer = countMp3Frames(readFileSync(samplePath))

    expect(fromFile).toBe(6089)
    expect(fromFile).toBe(fromBuffer)
  })

  it('matches mediainfo for a generated 3-second tone MP3', async () => {
    const tonePath = join(fixturesDir, 'tone-3s.mp3')
    await expect(countMp3FramesFromFile(tonePath)).resolves.toBe(116)
  })

  it('throws AppError for a non-MP3 file path', async () => {
    await expect(countMp3FramesFromFile(join(fixturesDir, 'README.md'))).rejects.toBeInstanceOf(
      AppError,
    )
  })
})

describe('countMp3FramesFromStream', () => {
  it('counts the sample when fed in small chunks', async () => {
    const sample = readFileSync(join(fixturesDir, 'sample.mp3'))
    const chunkSize = 1024
    async function* chunks() {
      for (let offset = 0; offset < sample.length; offset += chunkSize) {
        yield sample.subarray(offset, offset + chunkSize)
      }
    }

    await expect(countMp3FramesFromStream(chunks())).resolves.toBe(6089)
  })
})
