# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS web-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY app ./app
COPY components ./components
COPY public ./public
COPY next.config.mjs postcss.config.mjs tsconfig.json ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    APP_DATA_DIR=/app/data \
    APP_STORAGE_DIR=/app/storage \
    PYTHON=python

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip python-is-python3 \
    && pip3 install --break-system-packages --no-cache-dir "edge-tts>=6.1,<8" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node server.js pptx.js ppt-schema.js pptx-svg.js courseware-schema.js rag.js workflow.js edge_tts_wrap.py ./
COPY --chown=node:node courseware-engine.js lieflat-charts.js lucide-unify.js mdrender.js scene-templates.js skilltree-data.js vortex.js ./
COPY --chown=node:node *.html ./
COPY --chown=node:node skill/index.html ./skill/
COPY --chown=node:node skilltree-app/generate.html skilltree-app/lucide-unify.js skilltree-app/skilltree-data.js skilltree-app/skilltree.html ./skilltree-app/
COPY --chown=node:node shu/icon.svg shu/index.html shu/lucide-unify.js shu/manifest.json shu/skilltree-data.js shu/sw.js shu/专升本高数技能树.html ./shu/
COPY --chown=node:node mouse-controlled-gecko/fostindex.html mouse-controlled-gecko/kjs.mp4 mouse-controlled-gecko/newkj.mp4 ./mouse-controlled-gecko/
COPY --chown=node:node data/rag-index.json data/rag-index.vectors.bin ./data/
COPY --chown=node:node --from=web-build /app/out ./out

RUN mkdir -p /app/data /app/storage \
    && chown -R node:node /app/data /app/storage

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
