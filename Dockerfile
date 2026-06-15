FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm /tmp/*
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
