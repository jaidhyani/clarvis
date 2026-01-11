#!/bin/bash

dir="$PWD"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/.env" ]; then
    set -a
    source "$dir/.env"
    set +a
    break
  fi
  dir="$(dirname "$dir")"
done

cd "$(dirname "$0")"
exec node server/index.js "$@"
