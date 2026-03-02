#!/bin/bash
echo "Waiting for backend deployment to complete..."
echo "Target: https://copyflow-adminportal-backend.onrender.com/admin/auth/manual-signup"

while true; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST https://copyflow-adminportal-backend.onrender.com/admin/auth/manual-signup \
    -H "Content-Type: application/json" \
    -d '{"email": "admin@copyflow.com", "password": "admin123"}')
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" == "201" ] || [ "$HTTP_CODE" == "200" ]; then
    echo "✅ Success! Admin user created."
    echo "Response: $BODY"
    break
  elif [[ "$BODY" == *"Unique constraint failed"* ]]; then
     echo "✅ Admin user already exists!"
     break
  else
    echo "⏳ Backend still updating (Status: $HTTP_CODE)... retrying in 10s"
    sleep 10
  fi
done
