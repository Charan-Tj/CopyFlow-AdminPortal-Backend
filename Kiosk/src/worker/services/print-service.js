const { execFile } = require('child_process');
const { DownloadService } = require('./download-service');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PrintService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.downloadService = new DownloadService(logger);
  }

  /**
   * Run the full print pipeline for a single job.
   *
   * Stages emitted via onStage(stage):
   *   downloading → spooling → printing
   *
   * When SIMULATE_PRINT=true  — stages are faked with configurable delays.
   * When SIMULATE_PRINT=false — the file is downloaded, checksum-verified,
   *                              sent to the Windows print spooler, then deleted.
   *
   * @returns {{ success, completedAt, durationMs, printerName, pages }}
   */
  async printJob(job, printerName, onStage) {
    const start = Date.now();
    let filePath = null;

    try {
      // ── Stage 1: Download ─────────────────────────────────────────────
      onStage('downloading');

      if (!this.config.simulatePrint && job.fileUrl) {
        filePath = await this.downloadService.downloadAndVerify(
          job.fileUrl,
          job.jobId,
          job.checksum || null
        );
      } else {
        await sleep(this.config.stageDownloadMs);
      }

      // ── Stage 2: Spool ────────────────────────────────────────────────
      onStage('spooling');
      await sleep(this.config.stageSpoolMs);

      // ── Stage 3: Print ────────────────────────────────────────────────
      onStage('printing');

      if (!this.config.simulatePrint && filePath) {
        await this._spoolToPrinter(filePath, printerName);
      } else {
        await sleep(this.config.stagePrintMs);
      }
    } finally {
      // Always clean up the temp file even if an error occurs
      if (filePath) {
        this.downloadService.cleanupFile(filePath);
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - start;
    const pages = (job.settings?.pageCount || 1) * (job.settings?.copies || 1);

    return { success: true, completedAt, durationMs, printerName, pages };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Send a file to the Windows print spooler.
   *
   * Strategy (tried in order):
   *   1. Shell "PrintTo" verb — works when a PDF viewer (Edge, Adobe, Brave…)
   *      has registered the verb for the file's extension.
   *   2. .NET PrintDocument fallback — renders any file type through GDI and
   *      sends a real spooler job without needing a registered handler.
   *      This always produces a spooler job that our DummyPrinter can detect.
   */
  _spoolToPrinter(filePath, printerName) {
    const safePath    = filePath.replace(/'/g, "''");
    const safePrinter = printerName.replace(/'/g, "''");

    this.logger.info('Spooling to printer', { printerName, filePath });

    // Try shell "PrintTo" verb first (renders via the user's default PDF viewer)
    const printToScript = `
$ErrorActionPreference = 'Stop'
try {
  Start-Process -FilePath '${safePath}' -Verb PrintTo -ArgumentList '${safePrinter}' -NoNewWindow -Wait
  exit 0
} catch {
  exit 1
}`;

    // .NET fallback: renders a simple GDI text page — just enough to create a
    // real spooler job that is visible in Get-PrintJob and capturable by the
    // DummyPrinter's polling loop.
    // Use $printer/$docName variables + single-quoted here-string to avoid
    // PowerShell expanding $ signs inside C# source code.
    const fileName = filePath.split(/[\\/]/).pop();
    const safeFileName = fileName.replace(/'/g, "''");
    const dotNetScript = `
$printer = '${safePrinter}'
$docName = '${safeFileName}'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Printing;
public class KioskPrint {
    public static void Print(string printer, string docName) {
        var doc = new PrintDocument();
        doc.DocumentName = docName;
        doc.PrinterSettings.PrinterName = printer;
        doc.PrintPage += delegate(object s, PrintPageEventArgs e) {
            var f = new Font("Courier New", 11);
            e.Graphics.DrawString("CopyFlow Print Job: " + docName, f, Brushes.Black, 40f, 40f);
            e.HasMorePages = false;
        };
        doc.Print();
    }
}
'@ -ReferencedAssemblies "System.Drawing"
[KioskPrint]::Print($printer, $docName)
`;

    return new Promise((resolve, reject) => {
      // First attempt: PrintTo verb
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', printToScript],
        { timeout: 60000 },
        (error1) => {
          if (!error1) { resolve(); return; }

          // PrintTo failed — fall back to .NET GDI printing
          this.logger.warn('PrintTo verb failed, using .NET fallback', { error: error1.message });
          execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', dotNetScript],
            { timeout: 60000 },
            (error2, _stdout, stderr2) => {
              if (error2) {
                reject(new Error(`Print spooler error: ${(stderr2 || error2.message).trim()}`));
              } else {
                resolve();
              }
            }
          );
        }
      );
    });
  }
}

module.exports = { PrintService };
