#!/bin/bash
set -e

echo "==> Installing dependencies..."
npm ci

echo "==> Type-checking application and Convex functions..."
npm run typecheck

echo "==> Building Next.js application..."
npm run build

echo "==> Build complete!"
