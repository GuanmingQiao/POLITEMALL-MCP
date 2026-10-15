FROM node:20-bookworm-slim

# Chromium for the streamed sign-in (see src/auth/signin-browser.ts). Installed from Debian rather
# than downloaded by Playwright so the image has one browser, from one place.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
# The container runs as root, which Chromium refuses to sandbox; the container is the boundary.
ENV CHROMIUM_NO_SANDBOX=1

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

EXPOSE 3000
CMD ["node", "dist/index.js"]
