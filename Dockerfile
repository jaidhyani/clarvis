FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install -g @anthropic-ai/claude-code

COPY server/ ./server/
COPY public/ ./public/

# Startup script: symlink ~/.claude to persistent volume, then start server
RUN printf '#!/bin/sh\nmkdir -p /data/.claude\nln -sfn /data/.claude ~/.claude\nexec node server/index.js\n' > /start.sh && \
    chmod +x /start.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["/start.sh"]
