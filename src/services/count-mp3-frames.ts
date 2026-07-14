import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'

import { AppError } from '../errors/app-error.js'

/** MPEG-1 Layer III bitrates in kbps, indexed by header bitrate bits (1–14). */
const MPEG1_LAYER3_BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
] as const

/** MPEG-1 sample rates in Hz, indexed by header sample-rate bits (0–2). */
const MPEG1_SAMPLE_RATES_HZ = [44100, 48000, 32000] as const

const MPEG_VERSION_1 = 0b11
const LAYER_III = 0b01
const BITRATE_FREE = 0b0000
const BITRATE_BAD = 0b1111
const SAMPLE_RATE_RESERVED = 0b11
const CHANNEL_MODE_MONO = 0b11
const ID3V1_LENGTH = 128

type Mpeg1Layer3Header = {
  bitrateKbps: number
  sampleRateHz: number
  padding: 0 | 1
  hasCrc: boolean
  isMono: boolean
  frameLength: number
}

const isId3v2 = (buffer: Buffer, offset: number): boolean =>
  offset + 10 <= buffer.length &&
  buffer[offset] === 0x49 &&
  buffer[offset + 1] === 0x44 &&
  buffer[offset + 2] === 0x33

const getId3v2TagLength = (buffer: Buffer, offset: number): number => {
  const size =
    ((buffer[offset + 6]! & 0x7f) << 21) |
    ((buffer[offset + 7]! & 0x7f) << 14) |
    ((buffer[offset + 8]! & 0x7f) << 7) |
    (buffer[offset + 9]! & 0x7f)

  const footerPresent = (buffer[offset + 5]! & 0x10) !== 0
  return 10 + size + (footerPresent ? 10 : 0)
}

const readId3v2Size = (buffer: Buffer, offset: number): number => {
  const totalTagLength = getId3v2TagLength(buffer, offset)

  if (offset + totalTagLength > buffer.length) {
    throw new AppError('Invalid MP3: truncated ID3v2 tag', 400)
  }

  return totalTagLength
}

const skipTrailingId3v1 = (buffer: Buffer): number => {
  if (buffer.length < ID3V1_LENGTH) {
    return buffer.length
  }

  const tagOffset = buffer.length - ID3V1_LENGTH
  const hasId3v1 =
    buffer[tagOffset] === 0x54 && buffer[tagOffset + 1] === 0x41 && buffer[tagOffset + 2] === 0x47

  return hasId3v1 ? tagOffset : buffer.length
}

const isId3v1Tag = (buffer: Buffer): boolean =>
  buffer.length >= ID3V1_LENGTH &&
  buffer[buffer.length - ID3V1_LENGTH] === 0x54 &&
  buffer[buffer.length - ID3V1_LENGTH + 1] === 0x41 &&
  buffer[buffer.length - ID3V1_LENGTH + 2] === 0x47

const hasFrameSync = (buffer: Buffer, offset: number): boolean => {
  if (offset + 1 >= buffer.length) {
    return false
  }

  const first = buffer[offset]!
  const second = buffer[offset + 1]!
  return first === 0xff && (second & 0xe0) === 0xe0
}

const parseMpeg1Layer3Header = (buffer: Buffer, offset: number): Mpeg1Layer3Header | null => {
  if (offset + 4 > buffer.length || !hasFrameSync(buffer, offset)) {
    return null
  }

  const b1 = buffer[offset + 1]!
  const b2 = buffer[offset + 2]!
  const b3 = buffer[offset + 3]!

  const versionBits = (b1 >> 3) & 0b11
  const layerBits = (b1 >> 1) & 0b11
  const protectionBit = b1 & 0b1
  const bitrateIndex = (b2 >> 4) & 0b1111
  const sampleRateIndex = (b2 >> 2) & 0b11
  const padding = ((b2 >> 1) & 0b1) as 0 | 1
  const channelMode = (b3 >> 6) & 0b11

  if (versionBits !== MPEG_VERSION_1 || layerBits !== LAYER_III) {
    return null
  }

  if (
    bitrateIndex === BITRATE_FREE ||
    bitrateIndex === BITRATE_BAD ||
    sampleRateIndex === SAMPLE_RATE_RESERVED
  ) {
    return null
  }

  const bitrateKbps = MPEG1_LAYER3_BITRATES_KBPS[bitrateIndex]
  const sampleRateHz = MPEG1_SAMPLE_RATES_HZ[sampleRateIndex]

  if (bitrateKbps === undefined || sampleRateHz === undefined || bitrateKbps === 0) {
    return null
  }

  const frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRateHz) + padding

  if (frameLength < 4) {
    return null
  }

  return {
    bitrateKbps,
    sampleRateHz,
    padding,
    hasCrc: protectionBit === 0,
    isMono: channelMode === CHANNEL_MODE_MONO,
    frameLength,
  }
}

const findNextFrameOffset = (buffer: Buffer, start: number, end: number): number => {
  for (let offset = start; offset + 4 <= end; offset += 1) {
    if (parseMpeg1Layer3Header(buffer, offset)) {
      return offset
    }
  }

  return -1
}

const isVbrMetadataFrame = (buffer: Buffer, offset: number, header: Mpeg1Layer3Header): boolean => {
  const sideInfoLength = header.isMono ? 17 : 32
  const payloadOffset = offset + 4 + (header.hasCrc ? 2 : 0) + sideInfoLength

  if (payloadOffset + 4 > offset + header.frameLength) {
    return false
  }

  const tag = buffer.subarray(payloadOffset, payloadOffset + 4).toString('ascii')
  return tag === 'Xing' || tag === 'Info' || tag === 'VBRI'
}

const countFramesInRange = (buffer: Buffer, start: number, end: number): number => {
  let offset = findNextFrameOffset(buffer, start, end)

  if (offset < 0) {
    throw new AppError('Invalid MP3: expected MPEG Version 1 Audio Layer III frames', 400)
  }

  let frameCount = 0

  while (offset + 4 <= end) {
    const header = parseMpeg1Layer3Header(buffer, offset)

    if (!header) {
      const nextOffset = findNextFrameOffset(buffer, offset + 1, end)
      if (nextOffset < 0) {
        break
      }
      offset = nextOffset
      continue
    }

    if (offset + header.frameLength > end) {
      break
    }

    if (!isVbrMetadataFrame(buffer, offset, header)) {
      frameCount += 1
    }

    offset += header.frameLength
  }

  if (frameCount === 0) {
    throw new AppError('Invalid MP3: no complete audio frames found', 400)
  }

  return frameCount
}

/**
 * Counts MPEG Version 1 Audio Layer III frames in an in-memory MP3 buffer.
 */
export const countMp3Frames = (buffer: Buffer): number => {
  if (buffer.length === 0) {
    throw new AppError('Invalid MP3: empty file', 400)
  }

  let offset = 0

  if (isId3v2(buffer, 0)) {
    offset = readId3v2Size(buffer, 0)
  }

  const end = skipTrailingId3v1(buffer)

  if (offset >= end) {
    throw new AppError('Invalid MP3: no audio frames found', 400)
  }

  return countFramesInRange(buffer, offset, end)
}

type FrameWalkState = {
  pending: Buffer
  skippedId3: boolean
  synced: boolean
  frameCount: number
}

const createFrameWalkState = (): FrameWalkState => ({
  pending: Buffer.alloc(0),
  skippedId3: false,
  synced: false,
  frameCount: 0,
})

/**
 * Consume complete frames from the rolling buffer.
 * Leaves trailing partial bytes in `state.pending` for the next chunk (carry-over).
 */
const consumePendingFrames = (state: FrameWalkState, hasMoreData: boolean): void => {
  if (!state.skippedId3) {
    if (state.pending.length < 10) {
      if (!hasMoreData && state.pending.length > 0) {
        throw new AppError('Invalid MP3: truncated ID3v2 tag', 400)
      }
      return
    }

    if (isId3v2(state.pending, 0)) {
      const tagLength = getId3v2TagLength(state.pending, 0)
      if (state.pending.length < tagLength) {
        if (!hasMoreData) {
          throw new AppError('Invalid MP3: truncated ID3v2 tag', 400)
        }
        return
      }
      state.pending = state.pending.subarray(tagLength)
    }

    state.skippedId3 = true
  }

  if (state.pending.length === 0) {
    return
  }

  let offset = 0

  if (!state.synced) {
    const nextOffset = findNextFrameOffset(state.pending, 0, state.pending.length)
    if (nextOffset < 0) {
      if (hasMoreData) {
        state.pending = state.pending.subarray(Math.max(0, state.pending.length - 3))
      }
      return
    }
    offset = nextOffset
    state.synced = true
  }

  while (offset + 4 <= state.pending.length) {
    const header = parseMpeg1Layer3Header(state.pending, offset)

    if (!header) {
      const nextOffset = findNextFrameOffset(state.pending, offset + 1, state.pending.length)
      if (nextOffset < 0) {
        state.pending = state.pending.subarray(offset)
        return
      }
      offset = nextOffset
      continue
    }

    if (offset + header.frameLength > state.pending.length) {
      state.pending = state.pending.subarray(offset)
      return
    }

    if (!isVbrMetadataFrame(state.pending, offset, header)) {
      state.frameCount += 1
    }

    offset += header.frameLength
  }

  state.pending = state.pending.subarray(offset)
}

const finalizeFrameCount = (state: FrameWalkState): number => {
  if (!state.synced) {
    throw new AppError('Invalid MP3: expected MPEG Version 1 Audio Layer III frames', 400)
  }

  if (state.frameCount === 0) {
    throw new AppError('Invalid MP3: no complete audio frames found', 400)
  }

  return state.frameCount
}

/**
 * Counts frames from a readable stream / async iterable of chunks.
 * Memory use stays near one chunk + carry-over bytes (never the whole file).
 *
 * Holds back the last 128 bytes until the stream ends so a trailing ID3v1 tag
 * is not mistaken for audio.
 */
export const countMp3FramesFromStream = async (
  source: AsyncIterable<Buffer | Uint8Array> | Readable,
): Promise<number> => {
  const state = createFrameWalkState()
  let reservedTail = Buffer.alloc(0)
  let totalBytes = 0

  const ingest = (incoming: Buffer, isEnd: boolean): void => {
    const combined = Buffer.concat([reservedTail, incoming])

    if (!isEnd) {
      if (combined.length <= ID3V1_LENGTH) {
        reservedTail = combined
        return
      }

      const processable = combined.subarray(0, combined.length - ID3V1_LENGTH)
      reservedTail = combined.subarray(combined.length - ID3V1_LENGTH)
      state.pending = Buffer.concat([state.pending, processable])
      consumePendingFrames(state, true)
      return
    }

    reservedTail = Buffer.alloc(0)
    const audioBytes = isId3v1Tag(combined)
      ? combined.subarray(0, combined.length - ID3V1_LENGTH)
      : combined
    state.pending = Buffer.concat([state.pending, audioBytes])
    consumePendingFrames(state, false)
  }

  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (buffer.length === 0) {
      continue
    }

    totalBytes += buffer.length
    ingest(buffer, false)
  }

  if (totalBytes === 0) {
    throw new AppError('Invalid MP3: empty file', 400)
  }

  ingest(Buffer.alloc(0), true)
  return finalizeFrameCount(state)
}

/**
 * Counts frames by streaming a file from disk (same incremental parser as uploads).
 */
export const countMp3FramesFromFile = async (filePath: string): Promise<number> => {
  return countMp3FramesFromStream(createReadStream(filePath, { highWaterMark: 64 * 1024 }))
}
