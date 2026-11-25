# Debian on purpose. The native modules ship glibc builds, so Alpine is a bad time.
FROM node:22-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

CMD ["node", "src/index.js"]
