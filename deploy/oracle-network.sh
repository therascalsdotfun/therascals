#!/usr/bin/env bash
# Create the Always Free network skeleton in a fresh Oracle tenancy.
# Idempotent: re-running reuses anything already named rascals-*.
#
# Two Oracle defaults break HTTP/HTTPS if you miss them, and both are handled
# here rather than left to the console wizard:
#   - the default security list carries no ingress rules at all
#   - subnets default to prohibit-internet-inbound-connection=true, which blocks
#     inbound even after the security list allows it
#
# Lookups filter by display-name in python rather than JMESPath: this CLI build
# rejects quoted hyphenated keys inside filter expressions, and prints nothing
# at all for an empty result set.
set -euo pipefail

TEN=$(grep '^tenancy=' "$HOME/.oci/config" | cut -d= -f2)
AD=$(oci iam availability-domain list --compartment-id "$TEN" --query 'data[0].name' --raw-output)
VCN_CIDR=10.0.0.0/16
SUBNET_CIDR=10.0.0.0/24

lookup() { # $1 = display-name wanted; reads list JSON on stdin
  python3 -c '
import json, sys
want = sys.argv[1]
try:
    rows = json.load(sys.stdin).get("data") or []
except Exception:
    rows = []
for r in rows:
    if r.get("display-name") == want:
        print(r["id"])
        break
' "$1"
}

echo "Region $(oci iam region-subscription list --query 'data[0]."region-name"' --raw-output) / $AD"

VCN=$(oci network vcn list --compartment-id "$TEN" --output json | lookup rascals-vcn)
if [ -z "$VCN" ]; then
  VCN=$(oci network vcn create --compartment-id "$TEN" --cidr-block "$VCN_CIDR" \
    --display-name rascals-vcn --dns-label rascalsvcn --query 'data.id' --raw-output)
  echo "  vcn created $VCN"
else
  echo "  vcn reused $VCN"
fi

IGW=$(oci network internet-gateway list --compartment-id "$TEN" --vcn-id "$VCN" --output json | lookup rascals-igw)
if [ -z "$IGW" ]; then
  IGW=$(oci network internet-gateway create --compartment-id "$TEN" --vcn-id "$VCN" \
    --display-name rascals-igw --is-enabled true --query 'data.id' --raw-output)
  echo "  igw created"
fi

SL=$(oci network security-list list --compartment-id "$TEN" --vcn-id "$VCN" --output json | lookup rascals-web)
if [ -z "$SL" ]; then
  SL=$(oci network security-list create --compartment-id "$TEN" --vcn-id "$VCN" --display-name rascals-web \
    --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0","description":"allow outbound"}]' \
    --ingress-security-rules '[{"protocol":"6","source":"0.0.0.0/0","description":"SSH","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"protocol":"6","source":"0.0.0.0/0","description":"HTTP","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},{"protocol":"6","source":"0.0.0.0/0","description":"HTTPS","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},{"protocol":"1","source":"0.0.0.0/0","description":"ICMP"}]' \
    --query 'data.id' --raw-output)
  echo "  security list created"
fi

RT=$(oci network route-table list --compartment-id "$TEN" --vcn-id "$VCN" --output json | lookup rascals-public-rt)
if [ -z "$RT" ]; then
  RT=$(oci network route-table create --compartment-id "$TEN" --vcn-id "$VCN" --display-name rascals-public-rt \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" \
    --query 'data.id' --raw-output)
  echo "  route table created"
fi

SUB=$(oci network subnet list --compartment-id "$TEN" --vcn-id "$VCN" --output json | lookup rascals-public)
if [ -z "$SUB" ]; then
  SUB=$(oci network subnet create --compartment-id "$TEN" --vcn-id "$VCN" --cidr-block "$SUBNET_CIDR" \
    --display-name rascals-public --dns-label rascalspub --route-table-id "$RT" \
    --security-list-ids "[\"$SL\"]" --prohibit-internet-ingress false \
    --query 'data.id' --raw-output)
  echo "  subnet created"
fi

# Prove both traps are actually closed instead of trusting the create calls.
# The ingress flag was renamed from prohibit-internet-inbound-connection, so
# read whichever field this API version returns.
oci network subnet get --subnet-id "$SUB" --output json > /tmp/rascals_sub.json 2>/dev/null
oci network security-list get --security-list-id "$SL" --output json > /tmp/rascals_sl.json 2>/dev/null
inbound=$(python3 -c '
import json
d = (json.load(open("/tmp/rascals_sub.json")).get("data") or {})
print(str(d.get("prohibit-internet-ingress", d.get("prohibit-internet-inbound-connection"))))
')
rules=$(python3 -c '
import json
d = (json.load(open("/tmp/rascals_sl.json")).get("data") or {})
print(len(d.get("ingress-security-rules") or []))
')
# Explicit numeric tests: `[ "" -ge 4 ]` would silently evaluate true.
[ "$inbound" = "False" ] || { echo "FAIL: subnet prohibits internet inbound (got '$inbound')"; exit 1; }
case $rules in '' | *[!0-9]*) echo "FAIL: ingress count not numeric (got '$rules')"; exit 1 ;; esac
[ "$rules" -ge 4 ] || { echo "FAIL: security list has only $rules ingress rules"; exit 1; }

mkdir -p "$HOME/.oci/state"
{
  echo "TENANCY=$TEN"
  echo "AD=$AD"
  echo "VCN=$VCN"
  echo "SUBNET=$SUB"
  echo "SECLIST=$SL"
  echo "ROUTE=$RT"
} > "$HOME/.oci/state/network.env"

echo
echo "Network ready: subnet allows internet inbound, $rules ingress rules present."
echo "Wrote ~/.oci/state/network.env"
