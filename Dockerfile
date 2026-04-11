# GrafanaProbe v2 — Multi-stage Docker build
# by Gopal Rao

# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm config set strict-ssl false && npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production backend
FROM node:20-slim AS production
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm config set strict-ssl false && npm ci --production
COPY backend/ ./
COPY --from=frontend-build /app/frontend/build /app/frontend/build
RUN mkdir -p data reports screenshots

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
