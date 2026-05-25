# Build stage - pinned to amd64 because the output is static files (arch-independent)
FROM --platform=linux/amd64 node:20-alpine AS builder

WORKDIR /app
LABEL org.opencontainers.image.source=https://github.com/krelltunez/dayglance

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app files
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginx:alpine

# Node.js is needed to run the proxy server (handles /api/webdav-proxy/ and
# /api/calendar-proxy/). nginx cannot URL-decode $arg_* variables, so a
# proxy_pass to a full HTTPS URL receives "https%3A%2F%2F..." and fails.
RUN apk add --no-cache nodejs

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config and proxy server
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/proxy-server.js /app/proxy-server.js
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

# Expose port 80
EXPOSE 80

# Start both the Node.js proxy server and nginx
CMD ["/start.sh"]
