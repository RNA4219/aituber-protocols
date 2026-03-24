FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV STORAGE_ROOT=./data/identity
ENV LEDGER_STORAGE_ROOT=./data/ledger

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data/identity /app/data/ledger

EXPOSE 3000

CMD ["node", "dist/server/src/server.js"]
