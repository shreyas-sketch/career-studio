#!/bin/sh
# The production container's command. Career Studio keeps each account's data
# in a schema of its own, so there is no single database to migrate here: the
# server creates the shared accounts schema and brings every account's schema
# up to date itself when it starts (src/instrumentation.ts), and new accounts
# are set up when they sign up.
set -eu
cd /app
exec node server.js
