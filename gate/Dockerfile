FROM node:22-alpine
WORKDIR /app
COPY server.js ./
RUN echo '{"type":"module"}' > package.json
USER node
EXPOSE 8080
CMD ["node", "server.js"]
