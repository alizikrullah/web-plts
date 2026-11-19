# Backend PLTS Web untuk Coolify. Dibangun dari root repo (konteks build "."), karena backend memakai modul hitung di folder shared.
FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY shared ./shared
COPY backend ./backend
WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
# Migrasi aman dijalankan berulang (hanya menerapkan file yang belum pernah jalan), lalu server menyala.
CMD ["sh", "-c", "npx tsx src/core/migrate.ts && npx tsx src/index.ts"]
