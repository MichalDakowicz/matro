FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --ignore-scripts --workspace @matro/web --include-workspace-root
RUN npm run build:web

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
RUN npm ci --omit=dev --ignore-scripts --workspace @matro/server
ENV NODE_ENV=production PORT=8484 MATRO_DATA=/data MATRO_MEDIA=/media MATRO_FFMPEG=/usr/bin/ffmpeg MATRO_FFPROBE=/usr/bin/ffprobe
VOLUME ["/data", "/media"]
EXPOSE 8484
USER node
CMD ["node", "packages/core/server/index.js"]
