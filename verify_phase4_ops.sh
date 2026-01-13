#!/bin/bash
echo "Testing Ops Endpoints..."

# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}' | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

# 2. Get Jobs (Paginated)
echo -e "\nGetting Jobs (Page 1, Limit 2)..."
curl -s -X GET "http://localhost:3000/admin/jobs?page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN"

# 3. Get Audit Logs (Paginated)
echo -e "\nGetting Audit Logs (Page 1, Limit 2)..."
curl -s -X GET "http://localhost:3000/admin/audit-logs?page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN"
