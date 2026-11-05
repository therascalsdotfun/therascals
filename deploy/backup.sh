#!/usr/bin/env bash
# Consistent off-box recovery bundle. Destination MUST be an rclone crypt remote.
set -euo pipefail
umask 077
VOL=${BACKUP_VOLUME:-/var/lib/docker/volumes/jackpot-state/_data}
ENV_FILE=${BACKUP_ENV_FILE:-/opt/rascals/repo/deploy/.env}
: "${BACKUP_REMOTE:?Set an encrypted rclone remote and dedicated backup path}"
[[ "$BACKUP_REMOTE" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9_./-]+$ ]] || { echo 'Invalid backup remote' >&2; exit 1; }
[[ "$BACKUP_REMOTE" != *'..'* ]] || { echo 'Invalid backup path' >&2; exit 1; }
REMOTE_NAME=${BACKUP_REMOTE%%:*}
# Do not silently upload decrypted wallet/agent configuration to an ordinary bucket.
rclone listremotes --long | awk -v name="$REMOTE_NAME:" '$1==name && $2=="crypt" {found=1} END {exit !found}' || { echo 'Backup destination must use an rclone crypt remote' >&2; exit 1; }
[[ -r "$VOL/public.sqlite" && -r "$ENV_FILE" ]] || { echo 'Database or recovery environment is missing' >&2; exit 1; }
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# Lock in the private backup working directory; overlapping scheduled/manual runs fail.
LOCK=${BACKUP_LOCK:-/run/rascals-backup/backup.lock}
mkdir -p "$(dirname "$LOCK")"
[[ -O "$(dirname "$LOCK")" ]] || { echo 'Backup lock directory has a different owner' >&2; exit 1; }
exec 9>"$LOCK"
flock -n 9 || { echo 'A backup is already running' >&2; exit 1; }
sqlite3 "file:$VOL/public.sqlite?mode=ro" ".backup '$WORK/public.sqlite'"
[[ $(sqlite3 "$WORK/public.sqlite" 'PRAGMA integrity_check') == ok ]] || { echo 'Backup integrity check failed' >&2; exit 1; }
cp "$ENV_FILE" "$WORK/deploy.env"
if [[ -f "$VOL/perps-secret" ]]; then cp "$VOL/perps-secret" "$WORK/perps-secret"; fi
# Environment may carry JACKPOT_PERPS_SECRET instead of a file. Keep the exact
# recovery environment inside the same encrypted artifact; never print it.
(cd "$WORK" && sha256sum public.sqlite deploy.env > SHA256SUMS)
if [[ -f "$WORK/perps-secret" ]]; then (cd "$WORK" && sha256sum perps-secret >> SHA256SUMS); fi
printf 'format=rascals-recovery-v1\ncreated_utc=%s\n' "$STAMP" > "$WORK/manifest.txt"
ARCHIVE="$WORK/rascals-backup-$STAMP.tar.gz"
FILES=(public.sqlite deploy.env SHA256SUMS manifest.txt)
if [[ -f "$WORK/perps-secret" ]]; then FILES+=(perps-secret); fi
tar -czf "$ARCHIVE" -C "$WORK" "${FILES[@]}"
DEST="${BACKUP_REMOTE%/}/therascals-v1"
NAME=$(basename "$ARCHIVE")
rclone copyto "$ARCHIVE" "$DEST/$NAME"
# Download through crypt and compare bytes before declaring success or retention.
rclone copyto "$DEST/$NAME" "$WORK/verified.tar.gz"
cmp -s "$ARCHIVE" "$WORK/verified.tar.gz" || { echo 'Backup read-back verification failed' >&2; exit 1; }
rclone delete "$DEST" --include 'rascals-backup-*.tar.gz' --min-age 14d
printf 'Verified encrypted recovery backup: %s/%s\n' "$DEST" "$NAME"
