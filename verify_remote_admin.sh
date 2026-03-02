#!/bin/bash
BASE_URL="https://copyflow-adminportal-backend.onrender.com"
echo "Testing Remote Admin at $BASE_URL..."

# 1. Login
echo "Logging in..."
RESPONSE=$(curl -s -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}')

TOKEN=$(echo $RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "Login failed. Response: $RESPONSE"
    exit 1
fi

echo "Login Successful! Token: ${TOKEN:0:15}..."

# 2. Check CORS headers (Simulated)
echo "Checking CORS..."
CORS_TEST=$(curl -I -s -H "Origin: http://localhost:3001" -H "Access-Control-Request-Method: GET" -X OPTIONS "$BASE_URL/admin/overview" | grep -i "Access-Control-Allow-Origin")
echo "CORS Header: $CORS_TEST"
