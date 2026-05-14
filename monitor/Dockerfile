FROM node:18-alpine

RUN apk add --no-cache android-tools curl

WORKDIR /app

COPY monitor/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY monitor/device-monitor.js monitor/resource-monitor.js ./
COPY common/license-check.js ./

CMD ["node", "device-monitor.js"]
