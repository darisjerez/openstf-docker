FROM node:18-alpine

RUN apk add --no-cache android-tools curl

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY spotify-healer.js ./

EXPOSE 9106
CMD ["node", "spotify-healer.js"]
