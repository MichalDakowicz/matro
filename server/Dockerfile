FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# The system FFmpeg is used, so the bundled static binaries are not needed in the image.
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
# public/ includes the desktop UI copied by scripts/sync-ui.js: run `npm run sync-ui` before building.
COPY public ./public
ENV NODE_ENV=production PORT=8484 MATRO_DATA=/data MATRO_MEDIA=/media MATRO_FFMPEG=/usr/bin/ffmpeg MATRO_FFPROBE=/usr/bin/ffprobe
VOLUME ["/data", "/media"]
EXPOSE 8484
USER node
CMD ["node", "src/index.js"]
