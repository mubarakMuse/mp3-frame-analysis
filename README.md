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

Expected response:

```json
{
  "frameCount": 6089
}
```

## Verify sample frame count

```bash
mediainfo --Inform="Audio;%FrameCount%" fixtures/sample.mp3
# 6089
```
