FROM node:20-slim

# Install latest Chromium and all required OS dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    fonts-liberation \
    procps \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading its bundled Chrome and use the system installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Also ensure npx puppeteer can find chrome if called directly
RUN npx puppeteer browsers install chrome || true

COPY . .

EXPOSE 3005
ENV PORT=3005

CMD ["node", "server.js"]
