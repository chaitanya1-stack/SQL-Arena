FROM node:22-bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --include=dev
COPY . .
COPY deploy/native-pg/start.sh /usr/local/bin/judge-start
RUN chmod 755 /usr/local/bin/judge-start
EXPOSE 10000
CMD ["/usr/local/bin/judge-start"]
