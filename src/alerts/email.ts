import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Issue } from '../models/types.js';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('alert-email');

let _transporter: Transporter | null = null;

/**
 * Get or create a nodemailer transporter (lazy singleton).
 * Returns null if SMTP is not configured.
 */
function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;

  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_PORT) {
    log.warn('SMTP not configured — email alerts are disabled');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASS
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });

  log.info({ host: env.SMTP_HOST, port: env.SMTP_PORT }, 'SMTP transporter created');
  return _transporter;
}

// ─── Severity helpers ──────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc2626';
    case 'warning': return '#f59e0b';
    case 'info': return '#3b82f6';
    default: return '#6b7280';
  }
}

function severityLabel(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

// ─── HTML Templates ────────────────────────────────────────────────

function immediateAlertHtml(issue: Issue, dashboardUrl: string): string {
  const revenueImpact = issue.estimatedRevenueCents
    ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}`
    : 'Unknown';
  const confidence = issue.confidence
    ? `${Math.round(issue.confidence * 100)}%`
    : 'N/A';
  const color = severityColor(issue.severity);
  const issueUrl = `${dashboardUrl}/issues/${issue.id}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RevBack Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#111827;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">RevBack</h1>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Subscription Issue Detection</p>
            </td>
          </tr>

          <!-- Severity Badge -->
          <tr>
            <td style="padding:24px 32px 0;">
              <span style="display:inline-block;background-color:${color};color:#ffffff;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase;">
                ${severityLabel(issue.severity)}
              </span>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:16px 32px 0;">
              <h2 style="margin:0;color:#111827;font-size:18px;font-weight:600;">${escapeHtml(issue.title)}</h2>
            </td>
          </tr>

          <!-- Description -->
          <tr>
            <td style="padding:12px 32px 0;">
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.5;">${escapeHtml(issue.description)}</p>
            </td>
          </tr>

          <!-- Details Table -->
          <tr>
            <td style="padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
                <tr style="background-color:#f9fafb;">
                  <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">
                    <span style="color:#6b7280;font-size:12px;font-weight:500;">Issue Type</span><br>
                    <span style="color:#111827;font-size:14px;font-weight:600;">${escapeHtml(issue.issueType)}</span>
                  </td>
                  <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">
                    <span style="color:#6b7280;font-size:12px;font-weight:500;">Revenue Impact</span><br>
                    <span style="color:#dc2626;font-size:14px;font-weight:600;">${revenueImpact}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;">
                    <span style="color:#6b7280;font-size:12px;font-weight:500;">Confidence</span><br>
                    <span style="color:#111827;font-size:14px;font-weight:600;">${confidence}</span>
                  </td>
                  <td style="padding:10px 16px;">
                    <span style="color:#6b7280;font-size:12px;font-weight:500;">Detected At</span><br>
                    <span style="color:#111827;font-size:14px;font-weight:600;">${new Date(issue.createdAt).toLocaleString()}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 32px 32px;" align="center">
              <a href="${issueUrl}" style="display:inline-block;background-color:#111827;color:#ffffff;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">
                View in Dashboard &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                You're receiving this because you configured alert notifications in RevBack.
                <br>
                <a href="${dashboardUrl}/alerts" style="color:#6b7280;">Manage alert settings</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function immediateAlertText(issue: Issue, dashboardUrl: string): string {
  const revenueImpact = issue.estimatedRevenueCents
    ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}`
    : 'Unknown';
  const confidence = issue.confidence
    ? `${Math.round(issue.confidence * 100)}%`
    : 'N/A';
  const issueUrl = `${dashboardUrl}/issues/${issue.id}`;

  return `
RevBack Alert — ${severityLabel(issue.severity)} Billing Issue Detected

${issue.title}

${issue.description}

Type: ${issue.issueType}
Revenue Impact: ${revenueImpact}
Confidence: ${confidence}
Detected At: ${new Date(issue.createdAt).toISOString()}

View in Dashboard: ${issueUrl}

---
Manage alert settings: ${dashboardUrl}/alerts
`.trim();
}

function digestHtml(issuesList: Issue[], dashboardUrl: string): string {
  const totalRevenue = issuesList.reduce((sum, i) => sum + (i.estimatedRevenueCents || 0), 0);
  const criticalCount = issuesList.filter(i => i.severity === 'critical').length;
  const warningCount = issuesList.filter(i => i.severity === 'warning').length;
  const infoCount = issuesList.filter(i => i.severity === 'info').length;

  const issueRows = issuesList.slice(0, 20).map(issue => {
    const color = severityColor(issue.severity);
    const revenue = issue.estimatedRevenueCents
      ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}`
      : '-';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;background-color:${color};color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;text-transform:uppercase;">${issue.severity}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <a href="${dashboardUrl}/issues/${issue.id}" style="color:#111827;font-size:13px;text-decoration:none;font-weight:500;">${escapeHtml(issue.title)}</a>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#dc2626;font-size:13px;font-weight:500;">${revenue}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RevBack Daily Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#111827;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">RevBack</h1>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Daily Issue Digest</p>
            </td>
          </tr>

          <!-- Summary -->
          <tr>
            <td style="padding:24px 32px;">
              <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Issues in the last 24 hours</h2>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:12px;background-color:#fef2f2;border-radius:6px;">
                    <span style="color:#dc2626;font-size:24px;font-weight:700;">${criticalCount}</span><br>
                    <span style="color:#991b1b;font-size:11px;font-weight:500;">Critical</span>
                  </td>
                  <td width="8"></td>
                  <td align="center" style="padding:12px;background-color:#fffbeb;border-radius:6px;">
                    <span style="color:#f59e0b;font-size:24px;font-weight:700;">${warningCount}</span><br>
                    <span style="color:#92400e;font-size:11px;font-weight:500;">Warning</span>
                  </td>
                  <td width="8"></td>
                  <td align="center" style="padding:12px;background-color:#eff6ff;border-radius:6px;">
                    <span style="color:#3b82f6;font-size:24px;font-weight:700;">${infoCount}</span><br>
                    <span style="color:#1e40af;font-size:11px;font-weight:500;">Info</span>
                  </td>
                  <td width="8"></td>
                  <td align="center" style="padding:12px;background-color:#f9fafb;border-radius:6px;">
                    <span style="color:#111827;font-size:24px;font-weight:700;">$${(totalRevenue / 100).toFixed(2)}</span><br>
                    <span style="color:#6b7280;font-size:11px;font-weight:500;">Revenue Impact</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Issues Table -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
                <tr style="background-color:#f9fafb;">
                  <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb;">Severity</th>
                  <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb;">Issue</th>
                  <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb;">Impact</th>
                </tr>
                ${issueRows}
              </table>
              ${issuesList.length > 20 ? `<p style="color:#6b7280;font-size:12px;margin:8px 0 0;">...and ${issuesList.length - 20} more issues</p>` : ''}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;" align="center">
              <a href="${dashboardUrl}/issues" style="display:inline-block;background-color:#111827;color:#ffffff;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">
                View All Issues &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                You're receiving this daily digest because you configured alert notifications in RevBack.
                <br>
                <a href="${dashboardUrl}/alerts" style="color:#6b7280;">Manage alert settings</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function digestText(issuesList: Issue[], dashboardUrl: string): string {
  const totalRevenue = issuesList.reduce((sum, i) => sum + (i.estimatedRevenueCents || 0), 0);
  const lines = issuesList.slice(0, 20).map(i => {
    const revenue = i.estimatedRevenueCents
      ? `$${(i.estimatedRevenueCents / 100).toFixed(2)}`
      : '-';
    return `  [${i.severity.toUpperCase()}] ${i.title} (Impact: ${revenue})`;
  });

  return `
RevBack Daily Digest

Issues in the last 24 hours: ${issuesList.length}
Total revenue impact: $${(totalRevenue / 100).toFixed(2)}

${lines.join('\n')}
${issuesList.length > 20 ? `\n  ...and ${issuesList.length - 20} more issues` : ''}

View all issues: ${dashboardUrl}/issues

---
Manage alert settings: ${dashboardUrl}/alerts
`.trim();
}

function testAlertHtml(dashboardUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RevBack Test Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#111827;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">RevBack</h1>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Subscription Issue Detection</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;" align="center">
              <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:24px;">
                <p style="margin:0;color:#166534;font-size:16px;font-weight:600;">Test Alert Successful</p>
                <p style="margin:8px 0 0;color:#15803d;font-size:14px;">Your email integration is working correctly. You will receive alerts here when billing issues are detected.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;" align="center">
              <a href="${dashboardUrl}" style="display:inline-block;background-color:#111827;color:#ffffff;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">
                Open Dashboard &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Simple HTML escaping for user content */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Send an immediate alert email for a single issue.
 */
export async function sendEmailAlert(
  recipients: string[],
  issue: Issue,
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      return { success: false, error: 'SMTP not configured' };
    }

    const env = getEnv();
    const from = env.SMTP_FROM || 'alerts@revback.io';
    const subject = `[RevBack] ${severityLabel(issue.severity)}: ${issue.title}`;

    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      text: immediateAlertText(issue, env.DASHBOARD_URL),
      html: immediateAlertHtml(issue, env.DASHBOARD_URL),
    });

    log.info({ issueId: issue.id, recipients: recipients.length }, 'Email alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err, issueId: issue.id }, 'Email alert delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a daily digest email summarizing recent issues.
 */
export async function sendEmailDigest(
  recipients: string[],
  issuesList: Issue[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      return { success: false, error: 'SMTP not configured' };
    }

    if (issuesList.length === 0) {
      log.debug('No issues for digest, skipping');
      return { success: true };
    }

    const env = getEnv();
    const from = env.SMTP_FROM || 'alerts@revback.io';
    const criticalCount = issuesList.filter(i => i.severity === 'critical').length;
    const subject = criticalCount > 0
      ? `[RevBack] Daily Digest: ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} + ${issuesList.length - criticalCount} more`
      : `[RevBack] Daily Digest: ${issuesList.length} issue${issuesList.length > 1 ? 's' : ''} detected`;

    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      text: digestText(issuesList, env.DASHBOARD_URL),
      html: digestHtml(issuesList, env.DASHBOARD_URL),
    });

    log.info({ recipients: recipients.length, issueCount: issuesList.length }, 'Email digest sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err }, 'Email digest delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a test email to verify SMTP configuration.
 */
export async function sendEmailTestAlert(
  recipients: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      return { success: false, error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in environment variables.' };
    }

    const env = getEnv();
    const from = env.SMTP_FROM || 'alerts@revback.io';

    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject: '[RevBack] Test Alert - Email Integration Working',
      text: `RevBack Test Alert\n\nYour email integration is working correctly.\n\nOpen Dashboard: ${env.DASHBOARD_URL}`,
      html: testAlertHtml(env.DASHBOARD_URL),
    });

    log.info({ recipients: recipients.length }, 'Email test alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err }, 'Email test alert delivery error');
    return { success: false, error: err.message };
  }
}
