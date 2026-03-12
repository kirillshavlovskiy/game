#!/bin/bash
# Use Node 20 if nvm is available (Node 22 causes Next.js to hang)
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 2>/dev/null || true
fi
exec "$(dirname "$0")/../node_modules/.bin/next" dev "$@"
