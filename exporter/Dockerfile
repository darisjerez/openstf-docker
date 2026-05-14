FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY stf-exporter.js ./

EXPOSE 9105
CMD ["node", "stf-exporter.js"]
