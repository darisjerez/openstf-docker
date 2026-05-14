FROM node:18-alpine

RUN apk add --no-cache android-tools curl

WORKDIR /app

COPY healer/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY healer/spotify-healer.js ./
COPY common/license-check.js ./

EXPOSE 9106
CMD ["node", "spotify-healer.js"]
