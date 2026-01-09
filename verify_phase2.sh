#!/bin/bash
echo "Verifying Job Upload Endpoint..."
curl -v -X POST http://localhost:3000/kiosks/PI_TEST_1/jobs \
  -H "Content-Type: application/json" \
  -H "x-kiosk-id: PI_TEST_1" \
  -H "x-kiosk-secret: secret123" \
  -d '{"page_count": 5, "color_mode": "BW"}'
echo -e "\n\nDone."
