# La compilation React a lieu dans une étape séparée.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build

# L’image finale ne contient ni Vite ni les dépendances de compilation.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY backend ./backend
COPY shared ./shared
COPY exemples ./exemples
COPY imports ./imports
COPY scripts ./scripts
COPY package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/index.js"]
