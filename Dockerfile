FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY mock-server/package.json ./mock-server/package.json
RUN npm ci

COPY frontend ./frontend

ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npm run build -w frontend

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY mock-server/package.json ./mock-server/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false \
  && npm cache clean --force

COPY backend/src/app.js backend/src/server.js ./backend/src/
COPY backend/src/config ./backend/src/config
COPY backend/src/controllers ./backend/src/controllers
COPY backend/src/middleware ./backend/src/middleware
COPY backend/src/models ./backend/src/models
COPY backend/src/routes ./backend/src/routes
COPY backend/src/services ./backend/src/services
COPY --from=build /app/frontend/dist ./frontend/dist

USER node

CMD ["npm", "start"]
