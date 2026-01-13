#!/bin/bash
# Script to separate Frontend and Backend into sibling directories

echo "Preparing to separate Frontend..."

# 1. Define paths
CURRENT_DIR=$(pwd)
PARENT_DIR=$(dirname "$CURRENT_DIR")
FRONTEND_DIR="$PARENT_DIR/CopyFlow-Frontend"

# 2. Check if destination exists
if [ -d "$FRONTEND_DIR" ]; then
  echo "Error: Directory $FRONTEND_DIR already exists."
  exit 1
fi

# 3. Move admin-dashboard to sibling directory
echo "Moving admin-dashboard to $FRONTEND_DIR..."
mv admin-dashboard "$FRONTEND_DIR"

# 4. Success message
echo "Done!"
echo "Backend is now in: $CURRENT_DIR"
echo "Frontend is now in: $FRONTEND_DIR"
echo ""
echo "Next Steps:"
echo "1. Verify the move: ls -l $FRONTEND_DIR"
echo "2. Initialize Git in the new frontend folder:"
echo "   cd $FRONTEND_DIR"
echo "   git init"
echo "   git add ."
echo "   git commit -m 'Initial frontend commit'"
echo "3. The current folder ($CURRENT_DIR) is now your Backend repo."
