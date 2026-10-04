# Portable image for a VM (e.g. Oracle Cloud Always Free) or any container host.
FROM node:22.22.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --include=dev
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0 DATA_DIR=/data/pglite
VOLUME /data
EXPOSE 2567
CMD ["npm", "start"]
