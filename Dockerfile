# Fire Isle: builds the client and serves it together with the multiplayer server.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
EXPOSE 8080
ENV PORT=8080
CMD ["node", "--experimental-strip-types", "server/server.ts"]
