#!/bin/bash
echo "Testing Admin Login..."
curl -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@copyflow.com", "password": "admin123"}'

echo -e "\n\nDone."
