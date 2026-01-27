# ---- Builder Stage ----
FROM node:18-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
# Install semua dependencies termasuk devDependencies untuk build jika diperlukan
RUN npm ci

# Salin source code dan build jika diperlukan
COPY . .

# ---- Production Stage ----
FROM node:18-alpine
WORKDIR /usr/src/app

# Buat user non-root untuk keamanan
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Salin hanya dependencies production dari builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app ./

# Ubah kepemilikan file ke user non-root
RUN chown -R nodeuser:nodejs /usr/src/app
USER nodeuser

# Expose port
EXPOSE 3000

# Jalankan aplikasi
CMD ["npm", "start"]
