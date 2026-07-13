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

const readId3v2Size = (buffer: Buffer, offset: number): number => {
  // Synchsafe integer: 7 bits per byte
  const size =
    ((buffer[offset + 6]! & 0x7f) << 21) |
    ((buffer[offset + 7]! & 0x7f) << 14) |
    ((buffer[offset + 8]! & 0x7f) << 7) |
    (buffer[offset + 9]! & 0x7f)

  const footerPresent = (buffer[offset + 5]! & 0x10) !== 0
  const totalTagLength = 10 + size + (footerPresent ? 10 : 0)

  if (offset + totalTagLength > buffer.length) {
    throw new AppError('Invalid MP3: truncated ID3v2 tag', 400)
  }

  return totalTagLength
}

const skipTrailingId3v1 = (buffer: Buffer): number => {
  if (buffer.length < 128) {
    return buffer.length
  }

  const tagOffset = buffer.length - 128
  const hasId3v1 =
    buffer[tagOffset] === 0x54 && buffer[tagOffset + 1] === 0x41 && buffer[tagOffset + 2] === 0x47

  return hasId3v1 ? tagOffset : buffer.length
}

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

  // Layer III frame length: floor(144 * bitrate / sampleRate) + padding
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

/**
 * Xing/Info/VBRI live after the header (+ optional CRC) and side information.
 * These metadata frames are valid MPEG frames but are not counted as audio frames
 * by tools such as mediainfo / ffprobe.
 */
const isVbrMetadataFrame = (buffer: Buffer, offset: number, header: Mpeg1Layer3Header): boolean => {
  const sideInfoLength = header.isMono ? 17 : 32
  const payloadOffset = offset + 4 + (header.hasCrc ? 2 : 0) + sideInfoLength

  if (payloadOffset + 4 > offset + header.frameLength) {
    return false
  }

  const tag = buffer.subarray(payloadOffset, payloadOffset + 4).toString('ascii')
  return tag === 'Xing' || tag === 'Info' || tag === 'VBRI'
}

/**
 * Counts MPEG Version 1 Audio Layer III frames in an MP3 buffer.
 *
 * Skips ID3v2 (start) and ID3v1 (end) metadata, walks consecutive frame headers
 * using the MPEG-1 Layer III frame-length formula, and excludes Xing/Info/VBRI
 * metadata frames from the total (matching mediainfo).
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

  offset = findNextFrameOffset(buffer, offset, end)

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
      // Truncated final frame — stop without counting it
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
