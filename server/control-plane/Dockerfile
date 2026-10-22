FROM node:25-bookworm-slim

# Chromium for the streamed sign-in (see src/auth/signin-browser.ts). Installed from Debian rather
# than downloaded by Playwright so the image has one browser, from one place.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
# Chromium runs with its own sandbox on. Set CHROMIUM_NO_SANDBOX=1 in the environment only as a
# fallback when the host cannot provide user namespaces (see server/README.md).

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Run unprivileged; the data volume must be owned by uid 1000 (see deploy/README.md).
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
