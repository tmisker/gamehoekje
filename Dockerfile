FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV PORT=3000
# De weetjes praten over het dagdeel ("vanmiddag"/"vanavond") en de
# statistiek telt op welke weekdag er gespeeld wordt; zonder TZ zou de
# container in UTC rekenen en zou een potje van 19:30 "vanmiddag" heten.
ENV TZ=Europe/Amsterdam
EXPOSE 3000
CMD ["node", "server/server.js"]
