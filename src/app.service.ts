import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CopyFlow API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0b;
      color: #e0e0e0;
      font-family: 'Courier New', monospace;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      text-align: center;
      position: relative;
      z-index: 2;
    }
    .ascii-art {
      font-size: 10px;
      line-height: 1.1;
      letter-spacing: 1px;
      white-space: pre;
      color: #5C3BFF;
      text-shadow: 0 0 20px rgba(92, 59, 255, 0.4);
      animation: glow 3s ease-in-out infinite alternate;
    }
    @keyframes glow {
      from { text-shadow: 0 0 10px rgba(92, 59, 255, 0.3), 0 0 40px rgba(92, 59, 255, 0.1); }
      to { text-shadow: 0 0 20px rgba(92, 59, 255, 0.6), 0 0 60px rgba(92, 59, 255, 0.3); }
    }
    .title {
      font-size: 14px;
      color: #888;
      margin-top: 24px;
      letter-spacing: 8px;
      text-transform: uppercase;
    }
    .subtitle {
      font-size: 11px;
      color: #444;
      margin-top: 8px;
      letter-spacing: 3px;
    }
    .status {
      margin-top: 32px;
      display: flex;
      justify-content: center;
      gap: 32px;
      font-size: 11px;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #555;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s ease-in-out infinite;
    }
    .dot-amber { background: #f59e0b; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .links {
      margin-top: 24px;
      display: flex;
      justify-content: center;
      gap: 16px;
      font-size: 11px;
    }
    .links a {
      color: #5C3BFF;
      text-decoration: none;
      padding: 4px 12px;
      border: 1px solid #5C3BFF33;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .links a:hover {
      background: #5C3BFF22;
      border-color: #5C3BFF88;
    }
    .particles {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      z-index: 1;
      pointer-events: none;
    }
    .particle {
      position: absolute;
      font-size: 14px;
      color: #5C3BFF11;
      animation: fall linear infinite;
    }
    @keyframes fall {
      from { transform: translateY(-20px) rotate(0deg); opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      to { transform: translateY(100vh) rotate(360deg); opacity: 0; }
    }
    .printer-anim {
      margin-top: 20px;
      font-size: 11px;
      color: #333;
      overflow: hidden;
      height: 16px;
    }
    .printer-anim span {
      display: inline-block;
      animation: typewriter 4s steps(40) infinite;
      overflow: hidden;
      white-space: nowrap;
      border-right: 2px solid #5C3BFF55;
    }
    @keyframes typewriter {
      0% { width: 0; }
      50% { width: 100%; }
      90% { width: 100%; }
      100% { width: 0; }
    }
  </style>
</head>
<body>
  <div class="particles" id="particles"></div>
  <div class="container">
    <div class="ascii-art">
   ██████╗  ██████╗ ██████╗ ██╗   ██╗
  ██╔════╝ ██╔═══██╗██╔══██╗╚██╗ ██╔╝
  ██║      ██║   ██║██████╔╝ ╚████╔╝ 
  ██║      ██║   ██║██╔═══╝   ╚██╔╝  
  ╚██████╗ ╚██████╔╝██║        ██║   
   ╚═════╝  ╚═════╝ ╚═╝        ╚═╝   
  ███████╗██╗      ██████╗ ██╗    ██╗
  ██╔════╝██║     ██╔═══██╗██║    ██║
  █████╗  ██║     ██║   ██║██║ █╗ ██║
  ██╔══╝  ██║     ██║   ██║██║███╗██║
  ██║     ███████╗╚██████╔╝╚███╔███╔╝
  ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ </div>
    <div class="title">Print Network API</div>
    <div class="subtitle">Distributed Cloud Print Infrastructure</div>
    <div class="printer-anim"><span>▸ receiving document... parsing pages... sending to node...</span></div>
    <div class="status">
      <div class="status-item"><div class="dot"></div> API Online</div>
      <div class="status-item"><div class="dot dot-amber"></div> Uptime: ${hours}h ${mins}m ${secs}s</div>
      <div class="status-item"><div class="dot"></div> v1.0.0</div>
    </div>
    <div class="links">
      <a href="/api">📄 Swagger Docs</a>
      <a href="/admin/auth/login" onclick="return false;">🔐 Admin API</a>
    </div>
  </div>
  <script>
    const chars = ['📄','🖨️','⚡','◆','◇','▪','▫','●','○'];
    const container = document.getElementById('particles');
    for (let i = 0; i < 25; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = chars[Math.floor(Math.random() * chars.length)];
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (8 + Math.random() * 12) + 's';
      p.style.animationDelay = Math.random() * 10 + 's';
      container.appendChild(p);
    }
  </script>
</body>
</html>`;
  }
}
