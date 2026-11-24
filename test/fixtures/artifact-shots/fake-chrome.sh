#!/bin/sh
# a Chrome that never starts: its arguments, one launch a line, in <its own path>.log
echo "$@" >> "$0.log"
exit 1
