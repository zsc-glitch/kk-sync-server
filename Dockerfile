FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/

RUN mkdir -p /app/data

ENV PORT=3100
ENV DATA_DIR=/app/data

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3100/health || exit 1

CMD ["node", "src/index.js"]
