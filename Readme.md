  VideoPipeline

A production-grade asynchronous video processing pipeline. Upload a video, get back a streamable HLS manifest — fully moderated, multi-resolution, adaptive bitrate.

---

# What It Does

1. Frontend uploads a video to the Express backend via HTTP
2. Backend streams the raw file to MinIO (S3-compatible object storage)
3. Backend pushes a lightweight job payload (not the file) onto a Redis queue
4. An isolated Python worker continuously polls the queue
5. Worker downloads the video from MinIO, runs nudity detection via NudeNet
6. If the video passes moderation, FFmpeg transcodes it into multiple HLS renditions
7. Worker uploads all `.ts` segments and `.m3u8` playlists back to MinIO
8. Worker publishes the result to a Redis Pub/Sub channel
9. Backend WebSocket layer (Socket.io) receives the Pub/Sub event and pushes it to the client in real time
10. Frontend receives the master manifest URL and plays the video via adaptive bitrate streaming

---

# Architecture

```
Frontend
   │
   │  HTTP (multipart/form-data)
   ▼
Express Backend
   │                 │
   │ Stream raw      │ Push job metadata
   ▼                 ▼
MinIO (raw/)      Redis Queue
                     │
                     │ brpop (blocking poll)
                     ▼
              Python Worker
                 │       │
                 │       │ Download from MinIO
                 ▼       ▼
           NudeNet    MinIO (raw/)
           Moderation
                 │
         ┌───────┴────────┐
       FAIL              PASS
         │                │
         │             FFmpeg HLS Transcoding
         │             (144p / 240p / 360p / 480p / 720p / 1080p)
         │                │
         │             Upload segments + manifests to MinIO (processed/)
         │                │
         └──────┬─────────┘
                │
         Redis Pub/Sub (results channel)
                │
         Express (subscriber)
                │
         Socket.io → Frontend (real-time status update)
```

---

# HLS Output Structure

Each processed video produces an adaptive bitrate stream:

```
processed/{nanoid}/
  master.m3u8          ← single URL given to the frontend player
  144p/
    playlist.m3u8
    seg000.ts
    seg001.ts
    ...
  360p/
    playlist.m3u8
    ...
  720p/
    playlist.m3u8
    ...
  1080p/
    playlist.m3u8
    ...
```

The frontend player reads `master.m3u8`, measures network speed, and automatically switches between renditions mid-playback. No quality is hardcoded on the client.

---

# Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML/JS + Socket.io client |
| Backend | Node.js + Express + Multer |
| Real-time | Socket.io (WebSocket) |
| Queue | Redis (native — `brpop` / `lpush`) |
| Pub/Sub | Redis (native — `publish` / `subscribe`) |
| Object Storage | MinIO (S3-compatible) |
| Worker | Python |
| Moderation | NudeNet |
| S3 Client (worker) | boto3 |
| Transcoding | FFmpeg (HLS) |

---

# Why Redis Is Used Twice

Redis serves two different roles in this system and they are intentionally separate:

**Queue (`lpush` / `brpop`)** — durable job delivery. The worker blocks on `brpop`, meaning it only wakes up when there is actual work. No polling, no CPU waste.

**Pub/Sub (`publish` / `subscribe`)** — real-time event broadcasting. Once the worker finishes (or rejects) a video, it publishes to a channel. The backend is subscribed and immediately forwards the result to the correct Socket.io client. Fire and forget — appropriate here because the final state is persisted separately.

---

# Why the Video Never Touches Redis

Redis is an in-memory store. A 500MB video pushed into a Redis queue would crash the instance. Only a small JSON job object moves through Redis:

```json
{
  "nanoid": "abc123",
  "url": "http://minio:9000/bucket/raw/abc123.mp4"
}
```

The actual file lives in MinIO at all times. The worker downloads it directly from there.

---

# Moderation

The Python worker samples one frame every 2 seconds from the video. Each frame is checked by NudeNet against explicit labels (`FEMALE_BREAST_EXPOSED`, `MALE_GENITALIA_EXPOSED`, `FEMALE_GENITALIA_EXPOSED`, `BUTTOCKS_EXPOSED`, `ANUS_EXPOSED`).

If more than 20% of sampled frames are flagged above a 0.5 confidence threshold, the video is rejected. The result — pass or fail with details — is published to the Redis `results` channel and forwarded to the client via Socket.io.

Flagged videos are not transcoded. The raw file is deleted from MinIO.

---

# Getting Started

## Prerequisites

- Node.js 18+
- Python 3.10+
- Redis
- MinIO
- FFmpeg (must be in system PATH)

## Backend

```bash
cd backend
npm install
node index.js
```

## Worker

```bash
cd worker
pip install -r requirements.txt
python worker.py
```

## MinIO

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Create a bucket called `videos` via the MinIO console at `http://localhost:9001`.

---

# Environment Variables

**Backend (`.env`)**
```
REDIS_HOST=localhost
REDIS_PORT=6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=videos
```

**Worker (`.env` or inline)**
```
REDIS_HOST=localhost
REDIS_PORT=6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=videos
```
