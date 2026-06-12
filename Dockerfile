# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build the project
RUN npm run build

# Stage 2: Run
FROM node:20-alpine AS runner

# Get unrar from linuxserver image
COPY --from=linuxserver/unrar:latest /usr/bin/unrar-alpine /usr/bin/unrar

WORKDIR /app

# Install runtime dependencies (7zip, file, unzip, and standard libs)
RUN apk add --no-cache 7zip file unzip libstdc++ libgcc

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
