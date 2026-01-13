#!/bin/bash
# Quick restart: touches a server file to trigger --watch restart
# Usage: ./restart.sh         (trigger restart via file touch)
#        ./restart.sh kill    (hard kill the server process)

cd "$(dirname "$0")"

if [[ "$1" == "kill" ]]; then
    pkill -f "node.*server/index.js" 2>/dev/null && echo "Server killed" || echo "No server running"
else
    # Touch a file to trigger node --watch restart
    touch server/index.js
    echo "Restart triggered"
fi
