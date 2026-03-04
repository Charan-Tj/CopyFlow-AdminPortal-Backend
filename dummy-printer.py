# Instructions to run:
# python3 dummy-printer.py

import http.server
import json
import urllib.request
import time
import sys
import os
import threading

PORT = 6310

def print_box(details):
    file_name = details.get('fileUrl', 'unknown').split('/')[-1] if details.get('fileUrl') else 'unknown'
    color_type = "Color" if details.get('color') else "Black & White"
    sides = str(details.get('sides', 'unknown')).title()
    
    print("\n\033[95m🖨️  CopyFlow Dummy Printer\033[0m")
    print("================================")
    print(f"📄 File: {file_name}")
    print(f"📃 Pages: {details.get('pages', 'unknown')} (Simulated)")
    print(f"📋 Copies: {details.get('copies', 1)}")
    print(f"🎨 Type: {color_type}")
    print(f"📑 Sides: {sides}")
    print("================================")

def animate_progress():
    total = 16
    for i in range(total + 1):
        percent = int((i / total) * 100)
        bar = '█' * i + '░' * (total - i)
        sys.stdout.write(f"\r\033[96mPrinting [{bar}] {percent}%\033[0m")
        sys.stdout.flush()
        time.sleep(0.3)
    print("\n\033[92m✅ Print Complete!\033[0m\n")

def process_job(job_details):
    print("\n\033[93mNew Print Job Received:\033[0m")
    
    # File download simulation
    file_url = job_details.get('fileUrl')
    if file_url:
        print(f"📥 Mock downloading file from: {file_url}")
        try:
            # Attempt actual download
            req = urllib.request.Request(file_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                content = response.read()
                print(f"✅ Downloaded {len(content)} bytes")
        except Exception as e:
            print(f"⚠️ Mock download warning: {e}")
    else:
        print("⚠️ No fileUrl provided in job mapping.")
    
    # Mock Processing
    time.sleep(1) 
    
    print_box(job_details)
    animate_progress()
    
    # Send ack back to NestJS Backend
    job_id = job_details.get('jobId')
    if not job_id:
        print("❌ No jobId provided, cannot send acknowledgment.")
        return
        
    ack_url = "http://localhost:3000/print/acknowledge"
    ack_data = json.dumps({"jobId": job_id, "status": "completed"}).encode('utf-8')
    req = urllib.request.Request(ack_url, data=ack_data, headers={'Content-Type': 'application/json'})
    
    try:
        with urllib.request.urlopen(req) as response:
            print(f"📨 Sent Acknowledgment to {ack_url}: HTTP \033[92m{response.getcode()}\033[0m")
    except Exception as e:
        print(f"❌ Failed to send Acknowledgment: {e}")

class PrinterHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/print':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                job_details = json.loads(post_data.decode('utf-8'))
                
                # Immediately accept the job
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "accepted"}).encode('utf-8'))
                
                # Start job processing in background thread
                threading.Thread(target=process_job, args=(job_details,), daemon=True).start()
                
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                print("❌ Invalid JSON received")
        else:
            self.send_response(404)
            self.end_headers()

def run(server_class=http.server.HTTPServer, handler_class=PrinterHandler):
    server_address = ('', PORT)
    httpd = server_class(server_address, handler_class)
    print(f"\n\033[92m🚀 Dummy Printer listening on port {PORT}...\033[0m")
    print("Press Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping printing server...")
        httpd.server_close()

if __name__ == '__main__':
    run()
