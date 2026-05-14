FROM node:18-alpine

WORKDIR /app

COPY exporter/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY exporter/stf-exporter.js ./
COPY common/license-check.js ./

EXPOSE 9105
CMD ["node", "stf-exporter.js"]
