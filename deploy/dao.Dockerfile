FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.json ./
COPY public ./public
RUN pnpm dao:release && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production DAO_HOST=0.0.0.0 DAO_PORT=4321
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/dao ./dist/dao
COPY --from=build /app/apps/dao/release-server.ts ./apps/dao/release-server.ts
COPY --from=build /app/apps/server/src/http/frontend.ts ./apps/server/src/http/frontend.ts
COPY --from=build /app/apps/server/src/http/csp.ts ./apps/server/src/http/csp.ts
COPY package.json ./
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/dao/release-server.ts"]
