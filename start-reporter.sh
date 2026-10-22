#!/usr/bin/env bash
# Start the Jarvis Board live reporter if it is not already running. Safe to run any number of times.
#   ./start-reporter.sh           start reporter.py (nohup) unless it is alive; prints its PID
#   ./start-reporter.sh --watch   also keep a watchdog loop alive that re-checks every 30 s (itself idempotent)
#   ./start-reporter.sh --stop    stop the watchdog and the reporter
# Files: reporter.pid, reporter.log, watchdog.pid (all git-ignored)
cd "$(dirname "$0")"
alive() { [ -f "$1" ] && p=$(cat "$1") && [ -n "$p" ] && kill -0 "$p" 2>/dev/null && grep -q "$2" "/proc/$p/cmdline" 2>/dev/null; }
if [ "${1:-}" = "--stop" ]; then
  alive watchdog.pid start-reporter && kill "$(cat watchdog.pid)"; alive reporter.pid reporter.py && kill "$(cat reporter.pid)"; rm -f watchdog.pid reporter.pid; echo stopped; exit 0
fi
if alive reporter.pid reporter.py; then echo "reporter already running · PID $(cat reporter.pid)"
else
  [ -f reporter.log ] && [ "$(stat -c %s reporter.log)" -gt 5000000 ] && mv reporter.log reporter.log.1
  nohup python3 -u reporter.py >> reporter.log 2>&1 < /dev/null &
  echo $! > reporter.pid; sleep 1
  alive reporter.pid reporter.py && echo "reporter started · PID $(cat reporter.pid)" || { echo "reporter failed to start, see reporter.log"; exit 1; }
fi
if [ "${1:-}" = "--watch" ] && ! alive watchdog.pid start-reporter; then
  nohup bash -c 'while :; do sleep 30; ./start-reporter.sh >/dev/null 2>&1; done' start-reporter-watchdog >/dev/null 2>&1 < /dev/null &
  echo $! > watchdog.pid; echo "watchdog started · PID $(cat watchdog.pid)"
fi
