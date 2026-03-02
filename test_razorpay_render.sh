#!/bin/bash
# test_razorpay_render.sh
# Usage: ./test_razorpay_render.sh <YOUR_RENDER_URL>
# Example: ./test_razorpay_render.sh https://copyflow-adminportal-backend.onrender.com

BASE_URL=$1

if [ -z "$BASE_URL" ]; then
  echo "Error: Please provide your Render Backend URL."
  echo "Usage: ./test_razorpay_render.sh <URL>"
  exit 1
fi

echo "Testing Payment Flow on $BASE_URL..."

# 1. Create a Job (Simulate Upload)
echo -e "\n1. Creating Print Job..."
JOB_RES=$(curl -s -X POST "$BASE_URL/kiosks/PI_TEST_1/jobs" \
  -H "Content-Type: application/json" \
  -H "x-kiosk-id: PI_TEST_1" \
  -H "x-kiosk-secret: secret123" \
  -d '{"page_count": 5, "color_mode": "COLOR"}')

echo "Response: $JOB_RES"
JOB_ID=$(echo $JOB_RES | grep -o '"job_id":"[^"]*' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "Failed to create job. Exiting."
  exit 1
fi

echo "Created Job ID: $JOB_ID"

# 2. Initiate Payment (Get Razorpay Order ID)
echo -e "\n2. Initiating Payment..."
PAY_RES=$(curl -s -X POST "$BASE_URL/jobs/$JOB_ID/pay" \
  -H "Content-Type: application/json")

echo "Response: $PAY_RES"
ORDER_ID=$(echo $PAY_RES | grep -o '"id":"[^"]*' | cut -d'"' -f4)
AMOUNT=$(echo $PAY_RES | grep -o '"amount":[^,]*' | cut -d':' -f2)

if [ -z "$ORDER_ID" ]; then
  echo "Failed to initiate payment. Exiting."
  exit 1
fi

echo "Razorpay Order ID: $ORDER_ID"
echo "Amount (paise): $AMOUNT"

echo -e "\n---------------------------------------------------"
echo "✅ Backend Payment Initiation Successful!"
echo "To fully complete the payment:"
echo "1. Use this Order ID ($ORDER_ID) in a frontend checkout flow."
echo "2. OR manually trigger the Webhook using Postman/Curl to simulate success."
echo "---------------------------------------------------"
