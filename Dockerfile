FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production JACKPOT_MODE=public HOST=0.0.0.0 PORT=4317
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/agent ./apps/agent
COPY --from=build /app/packages ./packages
COPY package.json ./
# Operator scripts and fixtures are deliberately absent from the release image.
RUN mkdir -p .data .credentials && chown node:node .data .credentials
USER node
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
