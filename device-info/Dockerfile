FROM node:18-alpine

WORKDIR /app

COPY device-info/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY device-info/device-info.js ./
COPY common/license-check.js ./

EXPOSE 9109
CMD ["node", "device-info.js"]
