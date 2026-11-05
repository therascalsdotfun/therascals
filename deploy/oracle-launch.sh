#!/usr/bin/env bash
# Launch (or reuse) the Always Free ARM instance and give it a reserved public IP.
# Depends on ~/.oci/state/network.env from oracle-network.sh.
#
# The launch call is also the only reliable capacity probe: this tenancy returns
# no usable limits data, so OUT_OF_CAPACITY can only be discovered by trying.
set -euo pipefail

[ -f "$HOME/.oci/state/network.env" ] || { echo "run oracle-network.sh first"; exit 1; }
. "$HOME/.oci/state/network.env"

NAME=${1:-rascals-1}
OCPU=${OCPU:-2}
RAM=${RAM:-12}

# This CLI prints nothing at all for an empty result set, so the parse has to
# tolerate no stdin rather than assume JSON.
existing=$(oci compute instance list --compartment-id "$TENANCY" --output json | python3 -c "
import json, sys
want = '$NAME'
try:
    rows = json.load(sys.stdin).get('data') or []
except Exception:
    rows = []
for r in rows:
    if r.get('display-name') == want:
        print(r['id'])
        break
")
if [ -n "$existing" ]; then
  echo "instance $NAME already exists: $existing"
  INST=$existing
else
  IMAGE=$(oci compute image list --compartment-id "$TENANCY" --operating-system "Canonical Ubuntu" \
    --shape "VM.Standard.A1.Flex" --output json | python3 -c '
import json, sys
rows = json.load(sys.stdin).get("data") or []
rows = [r for r in rows
        if r.get("operating-system-version") == "24.04"
        and "minimal" not in (r.get("display-name") or "").lower()]
rows.sort(key=lambda r: r.get("time-created") or "", reverse=True)
if not rows:
    sys.exit("no Ubuntu 24.04 aarch64 image found")
print(rows[0]["id"])
')
  echo "launching $NAME: VM.Standard.A1.Flex, $OCPU OCPU, ${RAM}GB, image ${IMAGE: -12}"
  if ! INST=$(oci compute instance launch \
      --compartment-id "$TENANCY" \
      --availability-domain "$AD" \
      --display-name "$NAME" \
      --shape "VM.Standard.A1.Flex" \
      --shape-config "{\"ocpus\":$OCPU,\"memoryInGBs\":$RAM}" \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --boot-volume-size-in-gbs 50 \
      --ssh-authorized-keys-file "$HOME/.oci/instance/rascals_oracle.pub" \
      --query 'data.id' --raw-output 2> /tmp/launch_err.txt); then
    echo "LAUNCH FAILED:"; grep -viE "authorization|signature" /tmp/launch_err.txt | tail -6
    exit 1
  fi
  echo "  requested: $INST"
fi

echo "waiting for RUNNING..."
for _ in $(seq 1 60); do
  state=$(oci compute instance get --instance-id "$INST" --query 'data."lifecycle-state"' --raw-output)
  case "$state" in
    RUNNING) break ;;
    PROVISIONING|STARTING|MOVING) sleep 10 ;;
    *) echo "unexpected state: $state"; exit 1 ;;
  esac
done
[ "${state:-}" = "RUNNING" ] || { echo "timed out waiting for RUNNING"; exit 1; }

IP=$(oci compute instance list-vnics --instance-id "$INST" --query 'data[0]."public-ip"' --raw-output)
[ -n "$IP" ] && [ "$IP" != "None" ] || { echo "instance has no public IP"; exit 1; }

# An ephemeral public IP is released when the instance stops, which would leave
# DNS pointing at someone else's address. Reserve it.
PIP=$(oci network public-ip list --compartment-id "$TENANCY" --scope REGION --ip-address "$IP" \
  --query 'data[0].id' --raw-output)
if [ -n "$PIP" ] && [ "$PIP" != "None" ]; then
  reserved=$(oci network public-ip get --public-ip-id "$PIP" --query 'data.reserved' --raw-output)
  if [ "$reserved" != "True" ]; then
    oci network public-ip update --public-ip-id "$PIP" --reserved true >/dev/null
    echo "reserved public IP $IP"
  else
    echo "public IP $IP already reserved"
  fi
else
  echo "WARNING: could not find the public-ip OCID for $IP; reserve it manually"
fi

# Hyphens are illegal in shell identifiers, and this file gets sourced.
key=${NAME//-/_}
cat >> "$HOME/.oci/state/network.env" <<EOF
INSTANCE_$key=$INST
IP_$key=$IP
EOF
echo
echo "ssh -i ~/.oci/instance/rascals_oracle -o StrictHostKeyChecking=accept-new ubuntu@$IP"
