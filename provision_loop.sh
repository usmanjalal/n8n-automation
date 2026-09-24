#!/usr/bin/env bash
# ==============================================================================
# Oracle Cloud Always Free 12GB Ampere ARM Direct Provisioning Loop
# Command: oci compute instance launch
# Target Region: ap-hyderabad-1 (uzxX:AP-HYDERABAD-1-AD-1)
# Shape: VM.Standard.A1.Flex (2 OCPUs, 12 GB RAM)
# ==============================================================================

set -uo pipefail

COMPARTMENT_ID="ocid1.tenancy.oc1..aaaaaaaa7m35cyrf4mxa4etbnxetqap6wlupzwmudcwlkhu7l4fig4tu4imq"
AVAILABILITY_DOMAIN="uzxX:AP-HYDERABAD-1-AD-1"
IMAGE_ID="ocid1.image.oc1.ap-hyderabad-1.aaaaaaaaiqjw7o5u3ecja5rayhq3jzhkut4werr6qcautsheuqbwrm7slhga"
SUBNET_ID="ocid1.subnet.oc1.ap-hyderabad-1.aaaaaaaaqavdyrpay6kwh7ayu7rkcojalf7ek5r7ky26jnmg7tftwc4um7ya"
SSH_AUTHORIZED_KEYS="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDn0stITXQKGouIpVEmYBIZWIYuUbS/1wbBRF/LxLZJtL07eFlG/grKkcHLL1okRfyhuJ3CFQwtIbyaLZCCvBsYFTBbB/Jf1NLeLY2AkhQEUG2WNdLyp2SRXfi41ZG0BH3k0ldZjcqkX4zHylXSwdBNUgr10DfGfw1zYpTSZZrHPK84BiZlbGNhfBxFRZG+U7OWhp0VyTHSwk+FMNWIfOJRF7cxH8U4B2URA0Ebg+12XdNwJiRBhmV6tp1ULNPTAw27t74/08MoAz2NeGuiNJ5swIApZ+rcw52bCuuVoskeU/mibymoqQzYxCjRGOFS+S12STMRc1sA99fYWjvh8mDd ssh-key-2026-09-18"
DISPLAY_NAME="instance-20260918-1711"
ENV_FILE="${PWD}/.env"

ATTEMPT=0
CURRENT_429_BACKOFF=300
RETRY_CAPACITY_TIME=120

echo "========================================================================"
echo " Starting Direct OCI Compute Instance Provisioning Loop"
echo " Shape:  VM.Standard.A1.Flex (2 OCPUs, 12 GB RAM)"
echo " Image:  Canonical-Ubuntu-24.04-aarch64 (${IMAGE_ID})"
echo " Subnet: subnet-20260918-1714 (${SUBNET_ID})"
echo " AD:     ${AVAILABILITY_DOMAIN}"
echo " Time:   $(date)"
echo "========================================================================"

# Suppress OCI file permission warnings
export OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING=True

while true; do
  ATTEMPT=$((ATTEMPT + 1))
  echo ""
  echo "[Attempt #${ATTEMPT}] $(date '+%Y-%m-%d %H:%M:%S') - Calling oci compute instance launch..."

  METADATA_JSON=$(python3 -c 'import json, sys; print(json.dumps({"ssh_authorized_keys": sys.argv[1]}))' "$SSH_AUTHORIZED_KEYS")
  SHAPE_CONFIG_JSON='{"ocpus": 2, "memory_in_gbs": 12}'

  LAUNCH_OUTPUT=$(oci compute instance launch \
    --availability-domain "$AVAILABILITY_DOMAIN" \
    --compartment-id "$COMPARTMENT_ID" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config "$SHAPE_CONFIG_JSON" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --assign-public-ip true \
    --display-name "$DISPLAY_NAME" \
    --metadata "$METADATA_JSON" \
    --output json 2>&1)
  STATUS_CODE=$?

  # Check if successful
  if [ $STATUS_CODE -eq 0 ]; then
    echo "🎉 SUCCESS! Compute instance launched successfully!"
    INSTANCE_ID=$(echo "$LAUNCH_OUTPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('data', {}).get('id', ''))")
    echo "Instance OCID: $INSTANCE_ID"

    # Wait for VNIC and Public IP
    echo "Waiting for public IP assignment..."
    sleep 15
    PUBLIC_IP=""
    for i in {1..10}; do
      PUBLIC_IP=$(oci compute instance list-vnics --instance-id "$INSTANCE_ID" --output json 2>/dev/null | python3 -c "
import sys, json
try:
    vnics = json.load(sys.stdin).get('data', [])
    for v in vnics:
        ip = v.get('public-ip')
        if ip:
            print(ip)
            break
except:
    pass
")
      if [ -n "$PUBLIC_IP" ]; then
        break
      fi
      sleep 10
    done

    echo "Public IP: ${PUBLIC_IP:-'Check OCI console'}"

    # Write to .env
    if [ -n "$PUBLIC_IP" ]; then
      if [ -f "$ENV_FILE" ]; then
        grep -v "^OCI_INSTANCE_IP=" "$ENV_FILE" > "${ENV_FILE}.tmp" || true
        mv "${ENV_FILE}.tmp" "$ENV_FILE"
      fi
      echo "OCI_INSTANCE_IP=${PUBLIC_IP}" >> "$ENV_FILE"
      echo "💾 Saved OCI_INSTANCE_IP=${PUBLIC_IP} to ${ENV_FILE}"
    fi

    # Trigger macOS notification and sound
    osascript -e 'display notification "Oracle 12GB ARM Instance Launched! IP: '"${PUBLIC_IP:-Assigned}"'" with title "Antigravity"' 2>/dev/null || true
    afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true

    exit 0
  fi

  # Error handling: Check for 429 TooManyRequests
  if echo "$LAUNCH_OUTPUT" | grep -iq -E "429|TooManyRequests"; then
    echo "⚠️ Rate limited (Compute 429 TooManyRequests)."
    echo "⏳ Sleeping for ${CURRENT_429_BACKOFF} seconds (~$((CURRENT_429_BACKOFF / 60))m $((CURRENT_429_BACKOFF % 60))s)..."
    sleep "$CURRENT_429_BACKOFF"
    CURRENT_429_BACKOFF=$(( CURRENT_429_BACKOFF + 10 ))
    RETRY_CAPACITY_TIME=$(( RETRY_CAPACITY_TIME + 10 ))
    echo "ℹ️ Hit sleep: Next sleep duration: ${CURRENT_429_BACKOFF}s | Retry duration increased by 10s to: ${RETRY_CAPACITY_TIME}s"
    continue
  fi

  # Error handling: Check for 'Out of host capacity'
  if echo "$LAUNCH_OUTPUT" | grep -iq "Out of host capacity"; then
    echo " Capacity issue detected: 'Out of host capacity'."
    echo "⏳ Retrying in ${RETRY_CAPACITY_TIME} seconds (~$((RETRY_CAPACITY_TIME / 60))m $((RETRY_CAPACITY_TIME % 60))s)..."
    sleep "$RETRY_CAPACITY_TIME"
    continue
  fi

  # Other unexpected errors
  echo "⚠️ Unexpected error encountered:"
  echo "$LAUNCH_OUTPUT" | head -n 20
  echo "⏳ Sleeping ${RETRY_CAPACITY_TIME} seconds (~$((RETRY_CAPACITY_TIME / 60))m $((RETRY_CAPACITY_TIME % 60))s) before retrying..."
  sleep "$RETRY_CAPACITY_TIME"
done
