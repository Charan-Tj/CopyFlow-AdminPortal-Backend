#!/bin/bash
echo "Testing Kiosk Ops..."

# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}' | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

# 2. Refill Paper
echo "Refilling PI_TEST_1..."
curl -s -X POST http://localhost:3000/admin/kiosks/PI_TEST_1/refill \
  -H "Authorization: Bearer $TOKEN"

# 3. Check Status
echo -e "\nChecking Status..."
curl -s -X GET http://localhost:3000/admin/kiosks \
  -H "Authorization: Bearer $TOKEN" | grep "HIGH"
