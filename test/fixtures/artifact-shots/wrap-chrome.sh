#!/bin/sh
# the real Chrome ($REAL_CHROME), its arguments logged first, one launch a line, in <its own path>.log
echo "$@" >> "$0.log"
exec "$REAL_CHROME" "$@"
