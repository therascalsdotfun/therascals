#!/usr/bin/env bash
# Retry the Always Free ARM launch until Singapore gives up a host.
#
# ap-singapore-2 is a single-AD tenancy and free ARM capacity is shared, so
# `Out of host capacity` is a transient supply error rather than a config fault.
# Every failed launch creates nothing, so retrying is safe and free.
set -uo pipefail

cd "$(dirname "$0")/.."
NAME=${1:-rascals-1}
DEADLINE_HOURS=${DEADLINE_HOURS:-12}
# Oracle throttles instance POSTs on a young free tenancy: retrying every few
# minutes turns "Out of host capacity" into a 429 that then takes longer to
# clear than the wait it saved. Hourly is the fastest this tenancy tolerated.
SLEEP=${SLEEP:-3600}

end=$(( $(date +%s) + DEADLINE_HOURS * 3600 ))
attempt=0
while [ "$(date +%s)" -lt "$end" ]; do
  attempt=$((attempt + 1))
  echo "=== attempt $attempt $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if OCPU=${OCPU:-2} RAM=${RAM:-12} bash deploy/oracle-launch.sh "$NAME"; then
    echo "launched on attempt $attempt"
    exit 0
  fi
  grep -qiE "out of host capacity" /tmp/launch_err.txt || {
    echo "not a capacity error — stopping so the real fault is visible:"
    tail -12 /tmp/launch_err.txt
    exit 1
  }
  echo "no capacity yet; sleeping ${SLEEP}s"
  sleep "$SLEEP"
done
echo "gave up after $attempt attempts with no host capacity in this region."
exit 1
