#!/bin/bash
echo "Testing Overview..."

# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}' | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

# 2. Get Overview
echo -e "\nGetting Overview..."
curl -s -X GET "http://localhost:3000/admin/overview" \
  -H "Authorization: Bearer $TOKEN"
