#!/bin/bash
JOB_ID="a703a61f-0883-4433-9c2c-641c8f03f442" # Using the PAID job from Phase 3
echo "Requesting Token for Job: $JOB_ID"

curl -v http://localhost:3000/kiosks/PI_TEST_1/jobs/$JOB_ID/token \
  -H "x-kiosk-id: PI_TEST_1" \
  -H "x-kiosk-secret: secret123"

echo -e "\n\nDone."
