# MP3 Frame Analysis

TypeScript API that accepts an MP3 upload and returns the number of MPEG-1 Layer III frames.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
```

## Scripts

| Command          | Description                      |
| ---------------- | -------------------------------- |
| `npm run dev`    | Start the API with file watching |
| `npm start`      | Start the API                    |
| `npm test`       | Run tests                        |
| `npm run lint`   | Lint with ESLint                 |
| `npm run format` | Format with Prettier             |
| `npm run build`  | Compile TypeScript to `dist/`    |

## Run

```bash
npm start
```

The server listens on `http://localhost:3000` (override with `PORT`).

## Health check

```bash
curl http://localhost:3000/health
```

## Upload endpoint

`POST /file-upload` accepts a multipart form field named `file`.

```bash
curl -X POST http://localhost:3000/file-upload \
  -F "file=@./fixtures/sample.mp3"
```

Success response:

```json
{
  "frameCount": 6089
}
```

### Error responses

All errors return JSON:

| Status | When                                                          |
| ------ | ------------------------------------------------------------- |
| `400`  | Missing/empty file, wrong field name, or not MPEG-1 Layer III |
| `404`  | Unknown route                                                 |
| `413`  | File larger than 100 MB                                       |
| `500`  | Unexpected server error                                       |

Example:

```json
{
  "error": "AppError",
  "message": "No file uploaded. Send a multipart field named \"file\"."
}
```

## How frame counting works

1. Skip ID3v2 (start) / ID3v1 (end) metadata tags.
2. Find the first valid MPEG Version 1 Layer III frame header.
3. Read bitrate, sample rate, and padding from the 4-byte header.
4. Compute frame size with `floor(144 * bitrate / sampleRate) + padding`.
5. Jump to the next frame and repeat.
6. Exclude Xing/Info/VBRI metadata frames from the total (same as mediainfo).

No NPM package is used to parse MP3 frames.

## Scalability

- Uploads are parsed with **Busboy** as a stream — the file is never fully buffered in RAM
- Frames are counted incrementally with a **carry-over buffer** across chunk boundaries
- Concurrent uploads are capped with **p-limit** (default 4, override with `UPLOAD_CONCURRENCY`)
- `stream.pipeline()` wires the request into Busboy for backpressure and cleanup
- Upload size is capped at **100 MB**

## Verify the sample

```bash
mediainfo --Inform="Audio;%FrameCount%" fixtures/sample.mp3
# 6089
```

```bash
npm test
```

## Project layout

```
src/
  app.ts                      # Express app
  index.ts                    # Server entry
  routes/file-upload.ts       # POST /file-upload
  services/count-mp3-frames.ts# MPEG-1 Layer III parser
  middleware/error-handler.ts # JSON error responses
  errors/app-error.ts
  types/mp3.ts
tests/
fixtures/sample.mp3
```

## Future improvements

With more time:

- Move heavy jobs to a queue (SQS / BullMQ) for horizontal scale and retries
- Support additional MPEG versions only if required
- Add request logging / metrics for production use
