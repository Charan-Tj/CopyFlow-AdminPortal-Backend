#!/bin/bash
echo "1. Checking Admin Kiosks Endpoint..."
curl -s http://localhost:3000/admin/kiosks | head -c 200
echo -e "\n\n2. Checking Admin Jobs Endpoint..."
curl -s http://localhost:3000/admin/jobs | head -c 200
echo -e "\n\n3. Checking Swagger JSON presence..."
curl -s http://localhost:3000/api-json | head -c 50
echo -e "\n\nDone."
