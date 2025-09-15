FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# --- Dev stage ---
FROM base AS dev
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

# --- Prod stage ---
FROM base AS prod
RUN npm ci --only=production
COPY . .
CMD ["npm", "start"]
