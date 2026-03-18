const axios = require('axios');

/**
 * Script to send a heartbeat for TEST01 node to mark it as ready for payment
 * 
 * Usage:
 *   node scripts/heartbeat-test01.js
 * 
 * Note: Make sure the backend is running on http://localhost:3000
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'secretKey';

// Manually create a JWT token for TEST01 operator
const jwt = require('jsonwebtoken');

async function main() {
  try {
    console.log('🔄 Triggering heartbeat for TEST01 node...\n');

    // Create a valid JWT token for the TEST01 node operator
    const payload = {
      nodeId: '1', // Assuming TEST01 has id 1 (check your database)
      nodeCode: 'TEST01',
      role: 'OPERATOR',
      email: 'operator@test01.com'
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    console.log('✅ Generated JWT token');
    console.log(`   Token: ${token.substring(0, 50)}...\n`);

    // Send heartbeat
    const response = await axios.post(
      `${API_URL}/node/heartbeat`,
      {
        paper_level: 'HIGH',
        printers: [
          {
            name: 'Printer-1',
            status: 'online',
            paper_level: 'HIGH'
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Heartbeat sent successfully!');
    console.log(`   Response: ${JSON.stringify(response.data, null, 2)}\n`);
    console.log('🎉 TEST01 is now marked as ready for payment!\n');

  } catch (err) {
    console.error('❌ Error sending heartbeat:');
    console.error(`   ${err.message}`);
    
    if (err.response) {
      console.error(`   Status: ${err.response.status}`);
      console.error(`   Response: ${JSON.stringify(err.response.data, null, 2)}`);
    }
    
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Make sure the backend is running: npm run start');
    console.log('   2. Make sure the database is seeded: npm run seed');
    console.log('   3. Check if TEST01 node exists in the database');
    process.exit(1);
  }
}

main();
