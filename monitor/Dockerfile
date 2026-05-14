FROM node:18-alpine

RUN apk add --no-cache android-tools curl

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY device-monitor.js resource-monitor.js ./

CMD ["node", "device-monitor.js"]
