FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY seed ./seed

# Banco (SQLite) e fotos ficam aqui: monte um volume persistente em /data.
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
