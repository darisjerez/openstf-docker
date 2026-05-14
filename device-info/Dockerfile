FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY device-info.js ./

EXPOSE 9109
CMD ["node", "device-info.js"]
