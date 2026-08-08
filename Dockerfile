# Lints, tests and builds the app, then serves the production build.
#   docker build -t inbound-triage .
#   docker run --rm -p 3000:3000 -e LLM_PROVIDER=offline inbound-triage
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run lint && npm test && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY next.config.ts ./
COPY --chown=node:node data ./data
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
