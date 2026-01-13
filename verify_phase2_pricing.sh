#!/bin/bash
echo "Testing Dynamic Pricing..."

# 1. Login to get token
echo "Logging in..."
LOGIN_RES=$(curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}')
TOKEN=$(echo $LOGIN_RES | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "Login failed. $LOGIN_RES"
    exit 1
fi
echo "Token: ${TOKEN:0:10}..."

# 2. Update Pricing via Admin API
echo "Updating Pricing to BW: 5.0, Color: 20.0..."
curl -s -X POST http://localhost:3000/admin/pricing \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bw_price": 5.0, "color_price": 20.0}' | grep "id"

# 3. Create a Job via Kiosk API
echo -e "\nCreating Job (5 pages, COLOR)... should be 100 INR"
JOB_RES=$(curl -s -X POST http://localhost:3000/kiosks/PI_TEST_1/jobs \
  -H "x-kiosk-id: PI_TEST_1" \
  -H "x-kiosk-secret: secret123" \
  -H "Content-Type: application/json" \
  -d '{"file_name": "test.pdf", "page_count": 5, "color_mode": "COLOR"}')

echo $JOB_RES
AMOUNT=$(echo $JOB_RES | grep -o '"payable_amount":"[^"]*' | cut -d'"' -f4)

if [ "$AMOUNT" == "100" ] || [ "$AMOUNT" == "100.00" ]; then
    echo "SUCCESS: Amount is $AMOUNT"
else
    echo "FAILURE: Amount is $AMOUNT (Expected 100)"
fi
