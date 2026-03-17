FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
# mpv: TTS + sound playback (headless); yt-dlp: YouTube streaming; bluez: BLE scanning
RUN apk add --no-cache ffmpeg mpv yt-dlp bluez
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/storage/migrations ./dist/storage/migrations
COPY src/ui/public ./dist/ui/public
VOLUME ["/data"]
EXPOSE 3000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
