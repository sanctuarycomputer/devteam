#!/bin/sh
# a Chrome that starts, says nothing, and leaves a child behind if only it is killed
echo "$@" >> "$0.log"
sleep 97531 &
wait
