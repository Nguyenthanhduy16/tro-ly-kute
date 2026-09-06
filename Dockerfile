FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

# Giữ SQLite trên volume để không mất streak/XP mỗi lần deploy lại.
ENV DB_PATH=/data/bot.db
VOLUME /data

CMD ["node", "--no-warnings=ExperimentalWarning", "src/index.js"]
