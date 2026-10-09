#!/bin/sh
set -eu
npm run db:migrate
npm run db:seed
exec ./node_modules/.bin/tsx server/index.ts
