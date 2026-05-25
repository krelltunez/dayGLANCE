#!/bin/sh
node /app/proxy-server.js &
exec nginx -g "daemon off;"
