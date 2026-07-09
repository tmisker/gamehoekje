FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/server.js"]
