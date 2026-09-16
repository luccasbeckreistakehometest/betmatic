#!/bin/sh
# Xvfb by hand instead of xvfb-run: on the noble Playwright image xvfb-run brings the X server up
# and then never launches the command, so the container sits "Up" with nothing listening.
# The display only matters for the refresh job, which opens Betano in a headed Chromium.
set -e
Xvfb :99 -screen 0 1600x1100x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
exec npx next start -p "${PORT:-3000}"
